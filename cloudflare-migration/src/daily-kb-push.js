import { createSql } from "./database.js";
import { createKbFlex } from "./flex.js";
import { addBirthdayButton } from "./birthday.js";
import { fetchWithTimeout } from "./http.js";

// Scheduled push of the KB table to every approved, un-paused group that has BOSS records.
export async function runDailyKbPush(env, fetcher = fetch, now = new Date()) {
  if (env.PRODUCTION_MODE !== "true" || env.ENABLE_DAILY_KB_PUSH !== "true") return { skipped: "disabled" };
  if (env.DATABASE_BACKEND !== "d1" || !env.BOSS_DB?.prepare || !env.LINE_CHANNEL_ACCESS_TOKEN) return { skipped: "not-configured" };
  const sql = createSql(env);
  // The admin card can switch the push off; a missing table or row means on.
  try {
    const setting = await sql`SELECT value FROM bot_settings WHERE key='daily_kb_push'`;
    if (setting[0]?.value === "off") return { skipped: "switched-off" };
  } catch {}
  // Runs every 30 minutes; only the slot matching the configured Taipei time (default 18:00) sends, once per day.
  const taipei = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((p) => [p.type, p.value]));
  const today = `${taipei.year}-${taipei.month}-${taipei.day}`, slot = `${taipei.hour}:${taipei.minute}`;
  let wanted = "18:00", lastSent = null;
  try {
    const rows = await sql`SELECT key,value FROM bot_settings WHERE key IN ('daily_kb_push_time','daily_kb_push_last')`;
    wanted = rows.find((r) => r.key === "daily_kb_push_time")?.value || wanted;
    lastSent = rows.find((r) => r.key === "daily_kb_push_last")?.value;
  } catch {}
  if (slot !== wanted) return { skipped: "not-this-time" };
  if (lastSent === today) return { skipped: "already-sent-today" };
  try {
    await sql`INSERT INTO bot_settings(key,value) VALUES('daily_kb_push_last',${today}) ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
  } catch {}
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
