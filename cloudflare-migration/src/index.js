import { neon } from "@neondatabase/serverless";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const bytes = (s) => new TextEncoder().encode(s);

export async function verifyLineSignature(body, signature, secret) {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey("raw", bytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes(body)));
  const actual = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
  if (actual.length !== signed.length) return false;
  let diff = 0;
  for (let i = 0; i < signed.length; i++) diff |= actual[i] ^ signed[i];
  return diff === 0;
}

export async function verifyDiscordSignature(body, timestamp, signature, publicKey) {
  if (!timestamp || !signature || !publicKey || !/^[a-fA-F0-9]{128}$/.test(signature) || !/^[a-fA-F0-9]{64}$/.test(publicKey)) return false;
  const hex = s => Uint8Array.from(s.match(/.{2}/g), h => parseInt(h, 16));
  try {
    const key = await crypto.subtle.importKey("raw", hex(publicKey), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, hex(signature), bytes(timestamp + body));
  } catch { return false; }
}

export function formatDiscordKb(rows) {
  if (!rows.length) return "📋 **HIT2 BOSS 重生時間表**\n\n目前沒有 BOSS 紀錄。";
  const fmtDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" });
  const fmtTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const groups = new Map();
  for (const row of rows) {
    const date = fmtDate.format(new Date(row.respawn_time));
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(row);
  }
  const lines = ["👑 **HIT2 BOSS 重生時間表**", "━━━━━━━━━━━━━━━━━━", ""];
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  for (const [date, items] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const first = new Date(items[0].respawn_time);
    const wd = weekdays[Number(new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "Asia/Taipei" }).format(first).replace(/Sun|Mon|Tue|Wed|Thu|Fri|Sat/g, m => ({Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6})[m]))];
    lines.push(`📅 **${date.slice(5).replace("-", "/")}（週${wd}）**`, "```", "時間       BOSS", "────────  ──────────");
    for (const row of items) lines.push(`${fmtTime.format(new Date(row.respawn_time))}   ${row.boss_name}`);
    lines.push("```", "");
  }
  lines.push("🕒 時區：Asia/Taipei");
  const result = lines.join("\n");
  return result.length > 2000 ? result.slice(0, 1950) + "\n\n…資料較多，已省略部分項目。" : result;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" && request.method === "GET") return json({ service: "hit2-boss-staging", mode: "read-only", status: "ok" });
    if (url.pathname === "/callback" && request.method === "POST") {
      const body = await request.text();
      if (!await verifyLineSignature(body, request.headers.get("x-line-signature"), env.LINE_CHANNEL_SECRET)) return new Response("Invalid signature", { status: 401 });
      // Safety: never acknowledge a production LINE event as processed during staging.
      return json({ error: "LINE command parity not yet implemented; do not switch production webhook" }, 503);
    }
    if (url.pathname === "/discord/interactions" && request.method === "POST") {
      const body = await request.text();
      const ok = await verifyDiscordSignature(body, request.headers.get("x-signature-timestamp"), request.headers.get("x-signature-ed25519"), env.DISCORD_PUBLIC_KEY);
      if (!ok) return new Response("Invalid signature", { status: 401 });
      let payload;
      try { payload = JSON.parse(body); } catch { return json({ error: "Invalid JSON" }, 400); }
      if (payload.type === 1) return json({ type: 1 });
      if (payload.type === 2 && payload.data?.name?.toLowerCase() === "kb") {
        if (!env.DISCORD_KB_LINE_CHAT_ID || !env.DATABASE_URL) return json({ type: 4, data: { content: "❌ Discord 資料庫設定尚未完成。", flags: 64 } });
        try {
          const sql = neon(env.DATABASE_URL);
          const rows = await sql`SELECT boss_name, respawn_time FROM boss_kills WHERE chat_id = ${env.DISCORD_KB_LINE_CHAT_ID} ORDER BY respawn_time ASC`;
          return json({ type: 4, data: { content: formatDiscordKb(rows), allowed_mentions: { parse: [] } } });
        } catch (e) {
          console.error("Discord query failed", e?.name);
          return json({ type: 4, data: { content: "❌ 讀取 BOSS 資料失敗，請稍後再試。", flags: 64 } });
        }
      }
      return json({ type: 4, data: { content: "❌ 不支援的 Discord 指令。", flags: 64 } });
    }
    return new Response("Not Found", { status: 404 });
  }
};
