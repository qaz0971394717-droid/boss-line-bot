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
