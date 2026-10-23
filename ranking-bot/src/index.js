import { fetchRanking, formatRanking } from "./ranking.js";

const enc = new TextEncoder();
const OWNER_PATTERN = /^U[a-f0-9]{32}$/i;
const json = (data, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function verifySignature(body, signature, secret) {
  if (!secret || !signature) return false;
  try {
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
    );
    return await crypto.subtle.verify(
      "HMAC", key, Uint8Array.from(atob(signature), (c) => c.charCodeAt(0)), enc.encode(body),
    );
  } catch {
    return false;
  }
}

const lineBase = (env) => (env.LINE_API_BASE || "https://api.line.me").replace(/\/$/, "");

async function lineCall(env, fetcher, path, payload) {
  const response = await fetcher(lineBase(env) + path, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const error = new Error("LINE request failed: " + response.status);
    error.status = response.status;
    throw error;
  }
}

// One retry for transient LINE errors; 4xx other than 429 will not get better.
// `to` omitted = broadcast to every friend of the bot.
export async function pushText(env, fetcher, to, text) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const messages = [{ type: "text", text }];
      await lineCall(env, fetcher, to ? "/v2/bot/message/push" : "/v2/bot/message/broadcast", to ? { to, messages } : { messages });
      return;
    } catch (error) {
      const retryable = !error.status || error.status >= 500 || error.status === 429;
      if (attempt === 2 || !retryable) throw error;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// `exclude` = codes already sent recently. The page is read deeper than ten entries so that, after
// skipping those, up to ten new videos can still be listed.
export async function buildMessage(env, fetcher, now = new Date(), { exclude = new Set(), limit = 10 } = {}) {
  const fetched = await fetchRanking(env, fetcher, exclude.size ? 60 : limit);
  let result = fetched, skipped = 0;
  if (fetched.ok && exclude.size) {
    const fresh = fetched.items.filter((item) => !exclude.has(item.code));
    skipped = fetched.items.length - fresh.length;
    result = { ...fetched, items: fresh.slice(0, limit) };
  }
  const label = env.RANKING_LABEL || "今日熱門";
  const text = result.ok && !result.items.length && skipped
    ? `📭 ${label}：今天沒有新的影片\n\n排行裡的 ${skipped} 部都是近幾天推播過的，所以今天不重複推。`
    : formatRanking(result, { label, now, skipped });
  return { result, text };
}

export async function runDaily(env, fetcher = fetch, now = new Date(), opts = {}) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) return { pushed: false, reason: "not-configured" };
  // A valid owner ID narrows delivery to one person; without it everyone who added the bot gets it.
  const owner = OWNER_PATTERN.test(env.OWNER_LINE_USER_ID || "") ? env.OWNER_LINE_USER_ID : null;
  const { result, text } = await buildMessage(env, fetcher, now, opts);
  await pushText(env, fetcher, owner, text);
  const codes = result.ok ? result.items.map((item) => item.code) : [];
  return { pushed: true, mode: owner ? "owner" : "broadcast", ok: result.ok, count: codes.length, codes, text };
}

const taipeiDay = (ms) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);

async function sameSecret(a, b) {
  const [x, y] = await Promise.all([a, b].map(async (v) => new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(String(v))))));
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// The home computer fetches the ranking (the site blocks cloud IPs) and leaves the latest good
// copy here, so asking the bot for "排行" returns it without any scraping from the cloud.
async function latestReply(env, now = Date.now()) {
  const saved = await env.LATEST?.get("latest", "json");
  if (!saved?.text) return "還沒有收到排行資料。電腦每天早上 8 點抓到後會更新，稍後再試。";
  const day = taipeiDay(saved.savedAt);
  return day === taipeiDay(now) ? saved.text : `⚠️ 這是 ${day} 的排行，今天的還沒更新。\n\n${saved.text}`;
}

const reply = (env, fetcher, replyToken, text) =>
  lineCall(env, fetcher, "/v2/bot/message/reply", { replyToken, messages: [{ type: "text", text }] });

export function createWorker({ fetcher = fetch } = {}) {
  return {
    async scheduled(event, env) {
      try {
        const outcome = await runDaily(env, fetcher, new Date(event.scheduledTime || Date.now()));
        console.log("Daily ranking:", JSON.stringify(outcome));
      } catch (error) {
        // The push itself failed (LINE problem); there is nobody left to tell, so log it.
        console.error("Daily ranking push failed:", error?.status || error?.name);
        throw error;
      }
    },

    async fetch(request, env, ctx) {
      const path = new URL(request.url).pathname;
      if (request.method === "GET" && path === "/")
        return json({
          service: "daily-ranking-bot",
          status: "ok",
          schedule: "08:00 Asia/Taipei",
          owner_configured: OWNER_PATTERN.test(env.OWNER_LINE_USER_ID || ""),
          line_configured: Boolean(env.LINE_CHANNEL_SECRET && env.LINE_CHANNEL_ACCESS_TOKEN),
        });
      if (request.method === "POST" && path === "/latest") {
        const token = (request.headers.get("authorization") || "").replace(/^Bearer /, "");
        if (!env.LINE_CHANNEL_ACCESS_TOKEN || !env.LATEST || !(await sameSecret(token, env.LINE_CHANNEL_ACCESS_TOKEN)))
          return new Response("Unauthorized", { status: 401 });
        let data;
        try {
          data = await request.json();
        } catch {
          return json({ error: "Invalid JSON" }, 400);
        }
        if (typeof data?.text !== "string" || !data.text || data.text.length > 4500) return json({ error: "Invalid text" }, 400);
        await env.LATEST.put("latest", JSON.stringify({ text: data.text, savedAt: Date.now() }));
        return json({ ok: true });
      }
      if (request.method !== "POST" || path !== "/callback") return new Response("Not Found", { status: 404 });

      const body = await request.text();
      if (!(await verifySignature(body, request.headers.get("x-line-signature"), env.LINE_CHANNEL_SECRET)))
        return new Response("Invalid signature", { status: 401 });
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      if (!Array.isArray(payload?.events)) return json({ error: "Invalid events" }, 400);
      if (!payload.events.length) return json({ ok: true });
      if (!env.LINE_CHANNEL_ACCESS_TOKEN) return json({ error: "Not configured" }, 503);

      const work = (async () => {
        let failed = 0;
        for (const event of payload.events) {
          if (event?.type !== "message" || event.message?.type !== "text" || !event.replyToken) continue;
          if (event.source?.type !== "user" || event.mode === "standby") continue;
          const userId = event.source.userId;
          const text = String(event.message.text || "").trim();
          const ownerSet = OWNER_PATTERN.test(env.OWNER_LINE_USER_ID || "");
          const isOwner = ownerSet && userId === env.OWNER_LINE_USER_ID;
          const allowed = isOwner || !ownerSet; // no owner configured = open to every friend
          try {
            if (text === "我的ID") {
              await reply(env, fetcher, event.replyToken, `你的 LINE User ID：\n${userId}\n${isOwner ? "（已設定為接收推播的帳號）" : "（目前所有好友都會收到推播）"}`);
            } else if (allowed && /^(排行|今日|今天|top|TOP|現在)$/.test(text)) {
              await reply(env, fetcher, event.replyToken, await latestReply(env));
            } else if (allowed) {
              await reply(env, fetcher, event.replyToken, "每天早上 8 點會自動推播前 10 名。\n輸入「排行」可以立即查看。");
            }
            // owner-only mode and not the owner: no reply, nothing stored
          } catch (error) {
            console.error("Reply failed:", error?.status || error?.name);
            failed++;
          }
        }
        return json({ ok: !failed }, failed ? 500 : 200);
      })();
      ctx?.waitUntil(work);
      return work;
    },
  };
}

export default createWorker();
