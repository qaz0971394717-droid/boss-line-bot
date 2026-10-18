# Migration audit — 2026-10-18 Asia/Taipei

Scope: legacy feature parity, deployed Cloudflare configuration, cross-group safety, backups/restoration and alert coverage. User requested repeated inspection and repair of omissions.

## Completed and verified

- Restored the original LINE command `同步提醒`. It schedules only future records in the requesting chat through the existing Discord-only Durable Object and preserves all kill/respawn timestamps. Unmapped chats are skipped. Staging cannot invoke the production service.
- Bound administrator password challenges to the initiating LINE user. Other members' ordinary messages and passwords cannot consume the challenge; another administrator attempt cannot replace a live challenge. Consumption and insertion use conditional SQL. Existing plaintext challenges expire without execution.
- Source 806f399743e5db6340a4f2a05d0979aa277373eb passed all 86 tests locally and in GitHub Actions, then staging deployment, then approved production deployment.
- Production deployment run 39091447232 succeeded; health verification confirmed D1, LINE/admin enabled, Discord reminders enabled and LINE respawn pushes disabled. Worker version a99a93c9-e314-4dac-beaa-09aabbba07c5.
- Production and staging backup restoration run 39091411392 succeeded. Each current export was round-tripped through private R2, restored into disposable D1 clones and compared across every application table. Boss records were deleted only in a clone, then recovered into another clone and compared again. All temporary databases were cleaned up. Live records were not modified.
- Added missing parts database daily backup, scheduled 05:45 Taipei via default-branch GitHub workflow (cron execution can be delayed). Run 39091430878 succeeded: export, private R2 upload/download, SHA-256 comparison, local SQLite restoration and integrity check. Only server-parts/daily backups older than 30 days are pruned; live parts records are untouched. Capacity warning at 250 MiB. Current parts allocated size 2,322,432 bytes.
- Today's existing production, staging and personal memo daily backups succeeded. Memo backup also restored downloaded SQL and checked integrity.
- Separate production/staging databases, chat-scoped boss records, confirmation/undo/overwrite protections and ordinary-chat filtering remain intact. Birthday feature remains disabled.
- Existing Discord reminders were independently observed delivering naturally at 10:35 Taipei earlier today.

## Known remaining gaps / verification limits

1. Discord slash command `/kb`: the production adapter currently exposes LINE /callback but does not enable /discord/interactions. Original DISCORD_PUBLIC_KEY, fixed LINE chat mapping and Discord application endpoint settings must be verified before enabling this route. Discord reminder repair does not establish slash-command migration.
2. Google Calendar OAuth publication: app configuration being External + Testing has not been verified or ruled out. That mode may expire refresh tokens after seven days. Do not claim permanent authorization until Google Auth Platform publication status is checked. Never replace GOOGLE_TOKEN_KEY; restored encrypted tokens require the original key or user reauthorization.
3. Alert coverage: BOSS production/staging backup/capacity incidents use the already-bound test LINE bot relay. Personal memo and newly added parts backup/capacity incidents currently create/update GitHub issues only; LINE relay currently accepts only production/staging. Do not claim all services notify LINE.
4. Legacy parts Python CI still reports two failures (hard-coded old version expectation and an 800W wattage assertion). Active Cloudflare migration tests and deployment at fd57e0ac3f06e94c191eab4b8aa57d08fd8cf586 passed. Legacy test failures are not evidence the active Worker is down, but should be resolved or retired deliberately.
5. A successful daily backup is a tested recovery point, not zero-data-loss protection; changes after that backup may need replay. GitHub cron start times are approximate. Workers/D1 health flags verify configuration, not a newly sent real LINE/Discord interaction.
6. The direct local HTTP health sweep could not yet establish network connectivity from this sandbox; production deploy's Cloudflare-side health check did succeed. Do not interpret local network timeout as service outage.

## Evidence

- Production: https://github.com/qaz0971394717-droid/boss-line-bot/actions/runs/39091447232
- Isolated restoration: https://github.com/qaz0971394717-droid/boss-line-bot/actions/runs/39091411392
- Parts verified backup: https://github.com/qaz0971394717-droid/boss-line-bot/actions/runs/39091430878
- Existing backups: production 39070172891; staging 39071705197; memo 39072660069.
