> Current production uses Cloudflare D1 via wrangler.production.toml. Neon and Render hold historical data only. Do not revert to them without reconciling new D1 writes. See [D1-MIGRATION.md](D1-MIGRATION.md) for the completed cutover and current recovery procedure. Instructions below are retained as historical context.

# Production deployment

Staging remains on `wrangler.toml`; production uses `wrangler.production.toml`
and the separate Worker `hit2-boss-production`.

## Preparation

1. Keep a data-and-schema backup of the production Neon branch. Verify its data
   can be read. Do not replace current production records with the staging seed.
2. Apply `sql/003_production_support.sql` to the production database after backup.
   This adds only durable challenge/event tables, leaving all existing boss and
   chat data intact. Internal table names are shared with the verified engine.
3. Deploy the separate production Worker with:

   `npx wrangler deploy --config wrangler.production.toml`

4. Set each secret using `npx wrangler secret put NAME --config wrangler.production.toml`:
   `DATABASE_URL` (production Neon), `LINE_CHANNEL_SECRET`,
   `LINE_CHANNEL_ACCESS_TOKEN` (original LINE account), and `ADMIN_PASSWORD`.
   Never paste secret values in chat or commit them.

The production entry point accepts no staging credential fallback. Its explicit
adapter reuses the tested command engine and always disables reminders and
Discord, regardless of supplied variables. Health flags report configuration
intent; they do not prove database or LINE connectivity.

## Cutover and rollback

Before cutover, record the original webhook URL exactly and verify the old
Render service remains available. Confirm original data, schemas, automated
tests, backup readability, and original LINE credential destination. Complete a
backup restore drill before approving cutover; a readable branch alone is not
a full restore test.

Switch only the original LINE account's webhook to the production Worker's
`/callback` after explicit cutover approval. Test both existing groups with KB,
a new kill, and cancellation, and compare each group's existing records.
If webhook verification or group commands fail, restore the recorded Render
webhook URL. Both services must use the same current production database so
webhook rollback preserves commands recorded since cutover. Do not restore an
older database snapshot just to roll back code.

Keep the old Render deployment, backup branch, and staging Worker available
until production verification is complete. Do not enable automatic reminders.
