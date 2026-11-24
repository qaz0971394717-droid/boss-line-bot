import { createSql } from "./database.js";
import { createKbFlex } from "./flex.js";
import { addBirthdayButton } from "./birthday.js";
import { fetchWithTimeout } from "./http.js";

// Scheduled push of the KB table to every approved, un-paused group that has BOSS records.
export async function runDailyKbPush(env, fetcher = fetch, now = new Date()) {
  if (env.PRODUCTION_MODE !== "true" || env.ENABLE_DAILY_KB_PUSH !== "true") return { skipped: "disabled" };
  if (env.DATABASE_BACKEND !== "d1" || !env.BOSS_DB?.prepare || !env.LINE_CHANNEL_ACCESS_TOKEN) return { skipped: "not-configured" };
  const sql = createSql(env);
  let groups;
  try {
    groups = await sql`SELECT chat_id FROM group_access WHERE status='approved' AND COALESCE(paused,0)=0 AND chat_id LIKE 'C%'`;
  } catch {
    groups = await sql`SELECT chat_id FROM group_access WHERE status='approved' AND chat_id LIKE 'C%'`;
  }
  const totals = { groups: groups.length, sent: 0, empty: 0, failed: 0 };
  for (const { chat_id: chatId } of groups) {
    try {
      const rows = await sql`SELECT boss_name, respawn_time FROM boss_kills WHERE chat_id=${chatId} ORDER BY respawn_time ASC`;
      if (!rows.length) { totals.empty++; continue; }
      const message = addBirthdayButton(createKbFlex(rows, now), env, chatId);
      const res = await fetchWithTimeout("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ to: chatId, messages: [message] })
      }, fetcher);
      if (res.ok) totals.sent++; else totals.failed++;
    } catch {
      totals.failed++;
    }
  }
  return totals;
}
