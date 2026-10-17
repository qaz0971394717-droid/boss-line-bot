# Automatic D1 space management

Applies independently to production and staging. Boss catalog, active kill /
respawn records, group settings and administrator challenges are never touched
by the retention queries.

## Daily order

1. Export a real D1 SQL backup to private R2. Download and SHA-256 verify it.
2. Write a local receipt containing database ID, R2 key, checksum and verification
   time. Cleanup refuses missing/mismatched receipts or receipts over one hour old.
3. Check account-wide daily quota headroom. Preserve a 20,000-write reserve and
   cap maintenance at 30,000 writes per database per run; actual query metadata
   tracks writes. Backlog/quota failures raise an alert rather than forcing work.
4. In batches of at most 250, delete only successfully delivered event records
   whose delivery time is more than 14 days old. Compact only successfully
   delivered replies over 24 hours old by setting reply to NULL; retain their
   event ID and delivered marker until day 14. Redelivery sees done and skips it.
5. Never delete or compact pending events or saved replies without delivery
   confirmation. An uncertain command may already have mutated data.
6. Monitor storage, daily reads/writes and maintenance results. Above ~250 MiB,
   50% of account daily reads/writes, backup failure or cleanup backlog/failure,
   create/update a GitHub issue. Only the automation's own exact-title issue is
   updated; it is closed after a successful healthy backup+cleanup check.

A separately scheduled read-only monitor runs every six hours. Scheduled jobs
may be delayed by GitHub. GitHub issue/email notification delivery depends on
repository watching and the user's GitHub notification settings; Actions also
records warnings/errors and a step summary.

## Replay protection and limits

Signed LINE events older than 14 days are acknowledged without running commands.
LINE redelivery preserves the original timestamp. This guard must be deployed
before old delivered metadata is pruned. Manual K timestamps in command text are
not affected. Missing timestamps remain accepted for backward compatibility;
LINE's documented webhook schema supplies a numeric timestamp.

Indexes keep retention scans bounded. DELETE/compaction frees reusable SQLite
pages; the reported allocated file size may not immediately shrink. No live
VACUUM or automatic destruction of core/pending data is performed.

This significantly reduces growth from repeated large KB replies, but cannot
promise unlimited free storage or availability under arbitrary traffic, outages,
large pending backlogs or account-wide quota exhaustion. Such conditions raise
alerts for review. R2 daily backups retain 30 days, with separate production and
staging prefixes. Historical migration backups are retained.
