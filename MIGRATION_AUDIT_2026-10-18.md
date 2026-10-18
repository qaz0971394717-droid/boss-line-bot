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

1. Discord slash command `/kb`: CORRECTION RELEASED at source 1150f1c85f87f9274f93da8eedd94888a60fd4bc. Production route now verifies the original application signature and reads only its configured LINE group; missing key/mapping fails closed. Actual deployment readiness returned discord_kb_configured=false. The original Discord public key, fixed group mapping and application Interaction Endpoint setting are still needed to complete activation.
2. Google Calendar OAuth publication: still blocked. The direct Google Cloud audience settings page in this cloud browser returns Site Unavailable / Unable to access this site, so publication status cannot be read or changed here. External + Testing has not been verified or ruled out; that mode may expire refresh tokens after seven days. The owner must verify Google Auth Platform publication status in an accessible account session. GOOGLE_TOKEN_KEY was not changed.
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
