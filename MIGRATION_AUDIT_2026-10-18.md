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

1. Discord slash command `/kb`: RESOLVED. User supplied the original application public key and selected the LINE group; source 92d939e4a188e82b6625b636591d8954adf3c0b5 configured them. Production deployment 39092292075 succeeded. Independent live check 39092366823 confirmed discord_kb_enabled=true, existing Discord reminders=true, LINE respawn push=false and unsigned request rejection (401). User saved the Discord interaction endpoint successfully at 11:07 Taipei. A separate end-user `/kb` content reply was not supplied in this chat.
2. Google Calendar OAuth publication: RESOLVED with user assistance. Added actual public homepage /about, privacy /privacy and terms /terms on the existing memo Worker; 38 tests and deployment 39092877689 passed, all three live pages verified. User filled branding URLs and supplied screenshot showing publishing status '實際運作中' at 11:16 Taipei. User reconnected Google Calendar, then confirmed item #6 successfully added with a 10-minute reminder at 11:17 Taipei. This validates post-publication calendar insertion; future Android notification receipt still depends on device/Google settings. GOOGLE_TOKEN_KEY was preserved.
3. Alert coverage: RESOLVED. Memo and parts backup/capacity incidents now reuse the existing bound test LINE destination. A GitHub incident is persisted first; failed delivery is retried under the same incident ID; repeated failures do not spam; recovery notifies once before closing the incident. Actual memo and parts integration test pushes were accepted by LINE in run 39091844242. Both daily backups reran successfully (39091854423, 39091854404).
4. Legacy parts Python CI: RESOLVED in commit 993cae1c10d8a42d5cc313aa5b4d514b54505c51. Fixed structured fields at position zero (e.g. power wattage without base specs), including editor updates; version assertion follows the current application version. All 32 Python tests passed in 39091804984. Cloudflare tests also passed (39091807415); active Worker did not need redeployment for legacy-only fixes.
5. A successful daily backup is a tested recovery point, not zero-data-loss protection; changes after that backup may need replay. GitHub cron start times are approximate. Workers/D1 health flags verify configuration, not a newly sent real LINE/Discord interaction.
6. The direct local HTTP health sweep could not yet establish network connectivity from this sandbox; production deploy's Cloudflare-side health check did succeed. Do not interpret local network timeout as service outage.

## Evidence

- Production: https://github.com/qaz0971394717-droid/boss-line-bot/actions/runs/39091447232
- Isolated restoration: https://github.com/qaz0971394717-droid/boss-line-bot/actions/runs/39091411392
- Parts verified backup: https://github.com/qaz0971394717-droid/boss-line-bot/actions/runs/39091430878
- Existing backups: production 39070172891; staging 39071705197; memo 39072660069.

## Correction release verified at 10:57 Taipei

- BOSS source: 1150f1c85f87f9274f93da8eedd94888a60fd4bc.
- 88 BOSS tests plus 2 notification incident/retry tests passed. Staging, memo and production deployments succeeded.
- Production run: https://github.com/qaz0971394717-droid/boss-line-bot/actions/runs/39091878368 ; Worker version 09163ea4-ae77-491c-8b17-e2659130b0ab.
- Production health confirmed Discord reminders enabled and LINE respawn pushes disabled. Discord `/kb` activation remains incomplete as documented above.
- Scheduled memo and parts workflows on main now load the existing private notification key and use the corrected incident handlers. No notification destination changed and no credentials are printed.

## User acceptance at 11:17 Taipei

Both previously account-blocked configuration items are now resolved as described above. Google Calendar #6 insertion is user-confirmed. No guarantee of never-expiring authorization is made; revocation and other OAuth lifecycle conditions still apply. Existing records were not reset during reconnection.
