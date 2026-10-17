# D1 migration candidate — not enabled in production

The production worker continues using Neon; the staging worker now uses D1. Production data has only been copied for disposable restore drills; production
writes and configuration have not been changed. Do not enable D1 on the production
worker before completing the remaining checks below.

## Implemented

- Explicit `DATABASE_BACKEND=d1` plus `BOSS_DB` binding; missing D1 cannot fall back
  to Neon. Existing Neon configuration remains the default.
- SQLite schema, indexed group/time lookup, bound-value SQL adapter, JSON and UTC
  timestamp conversion. Existing pending event claims are preserved, never replayed.
- Read-only PostgreSQL snapshot export and private-file SQL converter with per-table
  row counts and deterministic content hashes. No user data is stored in git.
- SQLite integration tests exercise command operations, event claims and migration.
  These are not a substitute for testing a real D1 binding in Workers.

## Authorization and verified progress

Token authorization now passes. Real D1 command tests and a Neon snapshot -> D1
-> R2 -> independent D1 restore drill passed. Production snapshot contained 62
boss types, 35 kills, 2 chat settings and 8 event records, compared across all
five tables without logging private row contents.

Staging has now been migrated to D1 using its OWN source snapshot: 62 boss types,
0 kills, 1 chat setting and 41 event records. Its R2 backup was restored and
compared before activation. The initial post-deploy health request failed, so
activation was conservatively marked uncertain; subsequent independent API
verification confirmed the exact D1 binding, flags, and disabled migration mode.
Public health separately reported database_backend=d1. Do not rerun the staging
migration as a rollback. Use wrangler.d1-staging.toml for future staging deploys.

Production still uses Neon. Live LINE validation of staging, production
maintenance/synchronization/cutover and recurring D1 production backups remain
required. No API token should be pasted into chat or source files.

## Safe completion order

1. Create a new isolated D1 validation database and new validation worker. Keep
   LINE disabled until credentials for the test channel are deliberately assigned.
2. Apply `d1/0001_core.sql`. Export a read-only source snapshot using psql with
   `-X -qAt -v ON_ERROR_STOP=1 -f d1/export-postgres.sql`, saving stdout privately.
   Confirm which Neon branch the secret points to before exporting.
3. Run `node scripts/convert-postgres-to-d1.mjs source.json import.sql`. Use only
   an empty target database. Import SQL privately, then compare all five tables'
   normalized data against the manifest, not just their row counts.
4. Validate signed webhook processing, LINE replies, every admin action, manual
   times, concurrent redelivery, two-group isolation and idle-first-message behavior.
   Measure real D1 rows_read/rows_written and database size. No reminders.
5. Implement D1 export to private R2 using a separate prefix, download and restore
   into an independent D1 test database, and compare data. Keep old PostgreSQL
   backups intact. Existing Neon daily backup is NOT a D1 backup.
6. Before production cutover, introduce an explicit maintenance gate, let in-flight
   requests drain, and take a final consistent export. Do not allow both databases
   to accept independent writes. Verify final import, then switch the worker binding.
7. Reopen writes, verify both production groups and watch errors/quotas. Rollback
   after accepting D1 writes requires migrating those new writes back; reverting
   config alone would lose them. Do not delete Neon during the rollback window.

## Remaining work

Live staging LINE validation, recurring D1 production backup scheduling, a
production maintenance gate, final synchronization and production cutover have
NOT been completed. No claim is made that this candidate fixes the first-message problem.
