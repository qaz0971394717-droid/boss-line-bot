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
export async function pushText(env, fetcher, to, text) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await lineCall(env, fetcher, "/v2/bot/message/push", { to, messages: [{ type: "text", text }] });
      return;
    } catch (error) {
      const retryable = !error.status || error.status >= 500 || error.status === 429;
      if (attempt === 2 || !retryable) throw error;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

export async function buildMessage(env, fetcher, now = new Date()) {
  const result = await fetchRanking(env, fetcher);
  return { result, text: formatRanking(result, { label: env.RANKING_LABEL || "今日熱門", now }) };
}

export async function runDaily(env, fetcher = fetch, now = new Date()) {
  if (!OWNER_PATTERN.test(env.OWNER_LINE_USER_ID || "") || !env.LINE_CHANNEL_ACCESS_TOKEN)
    return { pushed: false, reason: "not-configured" };
  const { result, text } = await buildMessage(env, fetcher, now);
  await pushText(env, fetcher, env.OWNER_LINE_USER_ID, text);
  return { pushed: true, ok: result.ok, count: result.ok ? result.items.length : 0 };
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
          const isOwner = OWNER_PATTERN.test(env.OWNER_LINE_USER_ID || "") && userId === env.OWNER_LINE_USER_ID;
          try {
            if (text === "我的ID") {
              await reply(env, fetcher, event.replyToken, `你的 LINE User ID：\n${userId}\n${isOwner ? "（已設定為接收推播的帳號）" : "請把它設定為 RANKING_OWNER_LINE_USER_ID。"}`);
            } else if (isOwner && /^(排行|今日|今天|top|TOP|現在)$/.test(text)) {
              const { text: message } = await buildMessage(env, fetcher);
              await reply(env, fetcher, event.replyToken, message);
            } else if (isOwner) {
              await reply(env, fetcher, event.replyToken, "每天早上 8 點會自動推播前 10 名。\n輸入「排行」可以立即查看。");
            }
            // anyone else: no reply, nothing stored
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
