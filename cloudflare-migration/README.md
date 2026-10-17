> Current deployment (2026-10-17): both staging and production use separate Cloudflare D1 databases. See [D1-MIGRATION.md](D1-MIGRATION.md) for current bindings, verified backup/restore and rollback constraints. Neon-specific instructions below describe the historical migration path.

# Cloudflare Workers migration (isolated development)

This branch is intentionally separate from production `main`. **Do not change LINE or Discord webhook URLs until parity tests pass.**

## Existing application
- `app.py`: Flask + line-bot-sdk + psycopg2 + PyNaCl
- LINE: `/callback`, message and postback handling, Flex replies, per-chat state
- Discord: `/discord/interactions`, Ed25519 request verification, `/kb`
- Neon: `boss_types`, `boss_kills`, `chat_settings`
- Reminders: existing Cloudflare reminder Worker via `REMINDER_WORKER_URL`

## Migration constraints
1. Workers cannot run the Flask/psycopg2 Python stack unchanged. Port handlers to Workers JavaScript/TypeScript, or use a compatible external HTTP service.
2. Neon connections from Workers should use an appropriate serverless-compatible driver (e.g. Neon HTTP) with careful transaction semantics.
3. Verify LINE signatures (HMAC SHA-256 over raw body) and Discord signatures (Ed25519 over timestamp + raw body) before processing.
4. Ensure no duplicate replies or reminders during parallel tests. Never write to production boss data from tests.
5. Preserve every existing command, authorization flow, formatting, per-chat isolation, and reminder behavior; compare behavior against `app.py`.
6. Store all credentials in Cloudflare Worker secrets, not the repository.
7. Confirm backup restore test, staging test suite, and rollback plan before production cutover.

## Cutover checklist
- [ ] Port DB access, commands, Flex cards, LINE callbacks, Discord /kb, reminders
- [ ] Test against isolated test DB and mock LINE/Discord API
- [ ] Deploy staging Worker without touching production webhooks
- [ ] Verify LINE and Discord signatures, webhook responses, command parity
- [ ] Confirm backup, rollback URLs, and no duplicate reminders
- [ ] Switch webhooks only after explicit approval

## Isolated staging database initialization
- Create a separate Neon staging branch using the schema-only option where available, so production rows are not copied. Never point the staging Worker at the production connection string.
- In the Neon SQL Editor for that staging branch, run `sql/000_staging_core.sql`, `sql/001_staging_admin_challenges.sql`, and `sql/002_staging_line_events.sql` in that order. The core migration creates the three application tables and seeds the 62 default bosses.
- Configure the staging branch connection string only as the Cloudflare Worker secret `STAGING_DATABASE_URL`; do not commit or paste it into chat.

## Staging administrator challenge and reminder setup (NOT production)
- Run `sql/001_staging_admin_challenges.sql` against **an isolated Neon staging database only**. The table stores the pending command and expiry, never the plaintext admin password.
- Keep `ENABLE_STAGING_ADMIN` unset or `false` until the staging table and `ADMIN_PASSWORD` Worker secret have been configured. Admin commands are safely rejected otherwise.
- Set `STAGING_MODE=true`, `ENABLE_STAGING_ADMIN=true` for staging-only administrator flows after creating the table.
- Keep `ENABLE_STAGING_REMINDERS=false` until an entirely separate reminder Worker is ready. To enable explicitly, set `ENABLE_STAGING_REMINDERS=true` with `STAGING_REMINDER_WORKER_URL` and `STAGING_REMINDER_API_KEY`, NEVER the production reminder endpoint or credentials.
- The delete-boss action removes that boss's kill records across all staging chats and attempts to cancel each affected chat's staging reminder. Do not treat a skipped or failed remote reminder operation as confirmation of cancellation.
- No LIVE LINE webhook, Render service, production Neon connection or production reminder service is changed by these instructions.

## Latest staging-only controls and alerts
- Discord /kb requires `STAGING_MODE=true` **and** `ENABLE_STAGING_DISCORD=true`. Leave the production Discord Interactions URL pointed at Render.
- Health `GET /` reports `line_enabled`, `admin_enabled`, and `reminders_enabled` flags (flags show configuration intent, not actual external connectivity).
- On staging reminder schedule/cancel failure, LINE commands show that the boss database write succeeded but the reminder was **not confirmed**. Administrator boss deletion warns for each affected chat whose cancellation failed.
- Reminder transport rejects a staging endpoint equal to `REMINDER_WORKER_URL`, or reuse of `REMINDER_API_KEY` when these production settings are supplied. Do not grant staging Worker access to production reminder secrets.
- Failed reminder requests are not yet retried or queued durably. Never treat this staging code as verified production reminder delivery.

## Handoff verification (2026-10-16)
- LINE reply and reminder HTTP requests abort after five seconds and reject redirects. They are not automatically retried: a timed-out request may already have changed remote state.
- A LINE reply failure is reported as a failed batch, while later events in that batch are still processed. Malformed events and events without a known chat are skipped; invalid signed top-level payloads return HTTP 400.
- The isolated database initialization section above lists all three staging SQL files in order. Durable `webhookEventId` claims prevent LINE redelivery from running a command again; stored replies may be retried, and acknowledged deliveries are skipped.
- If a command crashes or its reply cannot be saved after a database mutation, its claim stays pending and redelivery fails closed. Reconcile the database/reminder state manually; do not automatically expire or delete pending claims. This favors preventing duplicate mutations over automatic recovery and does not provide atomic exactly-once delivery across PostgreSQL and external APIs.
- A successful LINE reply whose delivery marker cannot be stored may still be retried with an already-used reply token. This requires operator reconciliation; automatic replay of the command is never attempted.
- Staging has not been deployed or checked against a real isolated Neon database in this handoff. Cloudflare sign-in and isolated staging secrets are required to perform that verification.
