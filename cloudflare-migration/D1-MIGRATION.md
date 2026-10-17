# D1 migration status — 2026-10-17

Both LINE workers now use Cloudflare D1. Production and staging have separate
D1 databases and separate data. Neon data is retained as a historical rollback
source; it is not current after D1 begins accepting writes.

## Production

- Worker: hit2-boss-production
- Config: wrangler.production.toml
- D1: hit2-boss-d1-production-38984686581
- ID: db692969-0b74-4dc5-952a-604847e15628
- Final source: the production Worker's own DATABASE_URL, exported through a
  temporary authenticated no-store route during a brief maintenance window.
- Preserved and compared: 62 boss types, 35 kills, 2 chat settings, 0 challenges,
  8 event records. No group identifiers or private row contents logged.
- Real D1 export uploaded to private R2 at
  d1-production/migration-38984686581.sql, downloaded, restored into an independent
  D1 database and compared across all five tables before activation.
- Migration run: https://github.com/qaz0971394717-droid/boss-line-bot/actions/runs/38984686581
- Migration mode disabled and temporary secret removed.

## Staging

- Config: wrangler.d1-staging.toml
- D1 ID: dfe1d761-05b1-4a72-b7b6-cd8255b9e7f5
- Its own source snapshot preserved 62 types, 0 kills, 1 setting, 0 challenges,
  41 events; production rows were NOT copied into staging.
- R2 cutover backup: d1-staging/migration-38984107626.sql; restore compared before
  activation. Independent API verification resolved an initially uncertain
  immediate health check after deployment.
- User confirmed actual LINE test reply says Cloudflare D1 on 2026-10-17 08:03.
- Daily backups: private R2 d1-staging/daily/, 30-day retention, 05:15 Taipei
  schedule (GitHub may delay execution). Initial scheduled-workflow push run passed.

## Backup and recovery

Production daily D1 backups use scripts/backup-d1-production.mjs with private
R2 prefix d1-production/daily/. Each backup is downloaded and SHA-256 compared.
Daily files are retained 30 days. Keep historical PostgreSQL .dump files;
PostgreSQL and D1 SQL backups are different formats. R2 bucket remains
hit2-neon-backup; its historical name does not determine the database format.

Restore a D1 SQL backup into a NEW isolated database first, compare all tables,
and update the correct Worker binding only after validation. An in-place old
backup restore loses all writes made after that backup.

Do not deploy an old Neon config as a casual rollback. New D1 writes would be
lost. Returning to PostgreSQL requires a maintenance window, export and reverse
conversion of current D1 data, validation and resynchronization before writes
resume. The historical Neon snapshot alone is not a lossless rollback.

## Validation and limits

56 tests pass, including SQLite command/migration tests, D1 binding requirements,
maintenance authentication and redelivery protection. Real remote D1 tests
validated concurrent claims, JSON replies, admin operations, HALF/time and group
isolation. Production and staging migration restore drills passed independently.
Actual production LINE reply verification is still requested after cutover.

This migration removes Neon from the running bot database path. It does not
prove the earlier first-message failure is fully resolved. Observe idle-first
messages separately. Free-tier limits and all future changes still require
monitoring. Pending event claims are deliberately never automatically replayed.
Reminders remain disabled.
