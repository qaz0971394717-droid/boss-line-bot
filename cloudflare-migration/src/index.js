import {undoEnvironment} from './undo.js';
import {opsRoute,bindAlerts} from './ops-alerts.js';
import { shouldProcessCommand } from "./command-filter.js";
import { expiredEvent } from "./retention-policy.js";
import { migrationGate } from "./migration.js";
import { createSql, hasDatabase } from "./database.js";
import { handleLineCommand, getChatId } from "./line-commands.js";
import { fetchWithTimeout } from "./http.js";
import { createEventStore } from "./events.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const bytes = (s) => new TextEncoder().encode(s);

export async function verifyLineSignature(body, signature, secret) {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey("raw", bytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes(body)));
  let actual;
  try { actual = Uint8Array.from(atob(signature), c => c.charCodeAt(0)); }
  catch { return false; }
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
    const wd = weekdays[({Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6})[new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "Asia/Taipei" }).format(first)]];
    lines.push(`📅 **${date.slice(5).replace("-", "/")}（週${wd}）**`, "```", "時間       BOSS", "────────  ──────────");
    for (const row of items) lines.push(`${fmtTime.format(new Date(row.respawn_time))}   ${row.boss_name}`);
    lines.push("```", "");
  }
  lines.push("🕒 時區：Asia/Taipei");
  const result = lines.join("\n");
  return result.length > 2000 ? result.slice(0, 1950) + "\n\n…資料較多，已省略部分項目。" : result;
}

export function createWorker({ commandHandler = handleLineCommand, fetcher = fetch, eventStoreFactory = createEventStore } = {}) {
 return {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const ops = await opsRoute(request,env,fetcher);
    if(ops)return ops;
    const maintenance = await migrationGate(request, env);
    if (maintenance) return maintenance;
    if (url.pathname === "/" && request.method === "GET") return json({ service: "hit2-boss-staging", mode: "staging", database_backend: env.DATABASE_BACKEND === "d1" ? "d1" : "neon", status: "ok", line_enabled: env.STAGING_MODE === "true" && env.ENABLE_STAGING_LINE === "true", admin_enabled: env.STAGING_MODE === "true" && env.ENABLE_STAGING_ADMIN === "true", reminders_enabled: env.STAGING_MODE === "true" && env.ENABLE_STAGING_REMINDERS === "true" });
    if (url.pathname === "/callback" && request.method === "POST") {
      const body = await request.text();
      if (!await verifyLineSignature(body, request.headers.get("x-line-signature"), env.LINE_CHANNEL_SECRET)) return new Response("Invalid signature", { status: 401 });
      // Explicitly opt-in to staging processing; never route production LINE here.
      if (env.STAGING_MODE !== "true" || !hasDatabase(env) || !env.LINE_CHANNEL_ACCESS_TOKEN || env.ENABLE_STAGING_LINE !== "true") {
        return json({ error: "Staging LINE disabled. Do not switch production webhook." }, 503);
      }
      let payload;
      try { payload = JSON.parse(body); } catch { return json({ error: "Invalid JSON" }, 400); }
      if (!payload || typeof payload !== "object" || !Array.isArray(payload.events)) return json({ error: "Invalid event payload" }, 400);
      const events = payload.events;
      const processing = (async () => {
      const outcomes = [];
      let eventStore;
      for (const event of events) {
        if (!event || typeof event !== "object") continue;
        if (event.mode === "standby" || !event.replyToken) continue;
        const chatId = getChatId(event.source);
        if (chatId === "unknown") continue;
        const command = event.type === "message" && event.message?.type === "text" && typeof event.message.text === "string" ? event.message.text : event.type === "postback" && typeof event.postback?.data === "string" && event.postback.data.startsWith("kbkill:") ? "KBKILL " + event.postback.data.slice(7) : event.type === "postback" && /^undo:[a-f0-9-]{36}$/.test(event.postback?.data||"") ? "復原" : event.type === "postback" && /^overwrite:(confirm|cancel):[a-f0-9-]{36}$/.test(event.postback?.data||"") ? (event.postback.data.split(":")[1]==="confirm"?"確認覆蓋 ":"取消覆蓋 ")+event.postback.data.split(":")[2] : null;
        if (!command) continue;
        if (expiredEvent(event)) continue;
        let stage = "event-validation";
        try {
          if (typeof event.webhookEventId !== "string" || !event.webhookEventId) throw new Error("Missing event identifier");
          const context={undoOperationId:event.type==='postback'&&event.postback?.data?.startsWith('undo:')?event.postback.data.slice(5):undefined,userId:event.source?.userId,eventTimestamp:Number.isFinite(event.timestamp)?event.timestamp:Date.now()};
          stage = "command-filter";
          if(commandHandler===handleLineCommand&&!await shouldProcessCommand(command,chatId,env,context))continue;
          stage = "database-client";
          eventStore ||= eventStoreFactory(env);
          stage = "event-claim";
          const claim = await eventStore.claim(event.webhookEventId);
          if (claim.state === "done") { outcomes.push("ok"); continue; }
          if (claim.state === "pending") throw new Error("Event requires reconciliation");
          stage = "command";
          const reply = claim.state === "ready" ? claim.reply : (await bindAlerts(command,chatId,env) || await commandHandler(command, chatId, undoEnvironment(env,command,chatId,context.userId), new Date(context.eventTimestamp), context));
          stage = "reply-storage";
          if (claim.state === "new") await eventStore.complete(event.webhookEventId, reply);
          if(!reply){await eventStore.delivered(event.webhookEventId);outcomes.push('ok');continue;}
          stage = "line-reply";
          const res = await fetchWithTimeout("https://api.line.me/v2/bot/message/reply", {
            method: "POST",
            headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ replyToken: event.replyToken, messages: [reply] })
          }, fetcher);
          if (!res.ok) throw new Error(`LINE reply HTTP ${res.status}`);
          stage = "delivery-storage";
          await eventStore.delivered(event.webhookEventId);
          outcomes.push("ok");
        } catch (e) {
          // Provider error text can contain URLs or credentials. Log only type.
          console.error("Staging LINE processing failed:", stage, e?.name);
          outcomes.push("failed");
        }
      }
      return json({ processed: outcomes.length, failed: outcomes.filter(x => x === "failed").length }, outcomes.includes("failed") ? 500 : 200);
      })();
      // Retain in-flight processing if LINE closes the webhook connection while
      // the database wakes up. Await the SAME promise so errors still yield 500
      // and redelivery can reuse stored replies without replaying mutations.
      if (ctx?.waitUntil) ctx.waitUntil(processing);
      return processing;
    }
    if (url.pathname === "/discord/interactions" && request.method === "POST") {
      if (env.STAGING_MODE !== "true" || env.ENABLE_STAGING_DISCORD !== "true") return json({ error: "Staging Discord disabled. Do not switch production interactions." }, 503);
      const body = await request.text();
      const ok = await verifyDiscordSignature(body, request.headers.get("x-signature-timestamp"), request.headers.get("x-signature-ed25519"), env.DISCORD_PUBLIC_KEY);
      if (!ok) return new Response("Invalid signature", { status: 401 });
      let payload;
      try { payload = JSON.parse(body); } catch { return json({ error: "Invalid JSON" }, 400); }
      if (!payload || typeof payload !== "object") return json({ error: "Invalid interaction payload" }, 400);
      if (payload.type === 1) return json({ type: 1 });
      if (payload.type === 2 && payload.data?.name?.toLowerCase() === "kb") {
        if (!env.DISCORD_KB_LINE_CHAT_ID || !hasDatabase(env)) return json({ type: 4, data: { content: "❌ Discord 資料庫設定尚未完成。", flags: 64 } });
        try {
          const sql = createSql(env);
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
}

export default createWorker();
