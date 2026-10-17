# Usability candidate — staging only

User instruction: validate in the test LINE group before production promotion.
This candidate must not be merged/promoted until that confirmation arrives.

- RESTART or 清除KB asks 是否清除目前KB紀錄？ Same sender in same chat
  must answer 是 within 60 seconds; 否 cancels. HALF and the boss catalog remain.
- Ordinary chat creates no durable event/reply record. A pending administrator
  password conversation retains its existing behavior (an intervening message
  can still consume it); actor-bound admin verification is a separate change.
- K, card K and explicit respawn changes use the signed LINE event timestamp for
  per-boss update ordering. A stale report cannot overwrite a newer report.
  This is not full ordering of cancellation/deletion/RESTART operations; those
  require tombstones or a per-chat operation log in a separate change.
- K 王名 YYYY-MM-DD HHmm (or HHmmss) produces one short text response.
- Batch-operation transaction improvements, undo, additional error diagnostics
  and LINE push alerts are not enabled by this candidate.

Production promotion is explicitly gated by .github/production-release.json.
It must name the tested and user-approved commit. Ordinary source pushes no
longer deploy production automatically. The production release workflow applies
additive schema preparation before deploying the approved commit.
