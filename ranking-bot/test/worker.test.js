import test from "node:test";
import assert from "node:assert/strict";
import { createWorker, pushText, runDaily, verifySignature } from "../src/index.js";

const OWNER = "U" + "a".repeat(32), OTHER = "U" + "b".repeat(32);
const SECRET = "channel-secret";
const baseEnv = { LINE_CHANNEL_SECRET: SECRET, LINE_CHANNEL_ACCESS_TOKEN: "tok", OWNER_LINE_USER_ID: OWNER, RANKING_SOURCE_URL: "https://my.test/hot" };
const html = (n) => `<html>${Array.from({ length: n }, (_, i) => `<a href="/cn/ssis-${100 + i}"><img alt="SSIS-${100 + i} 片名${i + 1}"></a>`).join("")}</html>`;

const kv = (initial) => {
  const store = new Map(initial ? [["latest", JSON.stringify(initial)]] : []);
  return { store, get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => void store.set(k, v) };
};

function harness({ site = () => ({ status: 200, body: html(10) }), line = () => 200 } = {}) {
  const sent = [];
  const fetcher = async (url, init) => {
    if (String(url).startsWith("https://api.line.me")) {
      const status = line(url, sent.length);
      sent.push({ url: String(url).replace("https://api.line.me", ""), body: JSON.parse(init.body), auth: init.headers.Authorization, status });
      return { ok: status < 400, status, text: async () => "" };
    }
    const r = site(url);
    return { status: r.status, ok: r.status < 400, url, text: async () => r.body };
  };
  return { sent, fetcher };
}
const sign = async (body, secret = SECRET) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))));
};
const event = (text, userId = OWNER, extra = {}) => ({ type: "message", replyToken: "r", source: { type: "user", userId }, message: { type: "text", text }, ...extra });
async function callback(worker, env, events, secret = SECRET) {
  const body = JSON.stringify({ events });
  return worker.fetch(new Request("https://x/callback", { method: "POST", headers: { "x-line-signature": await sign(body, secret) }, body }), env);
}

test("the daily run pushes the ranking to the owner only", async () => {
  const h = harness();
  const out = await runDaily(baseEnv, h.fetcher, new Date("2026-10-22T00:00:00Z"));
  assert.deepEqual({ ...out, text: undefined }, { pushed: true, mode: "owner", ok: true, count: 10, text: undefined });
  assert.match(out.text, /TOP 10/);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].url, "/v2/bot/message/push");
  assert.equal(h.sent[0].body.to, OWNER);
  assert.equal(h.sent[0].auth, "Bearer tok");
  const text = h.sent[0].body.messages[0].text;
  assert.match(text, /今日熱門 TOP 10/);
  assert.match(text, /2026-10-22 08:00/);
  assert.match(text, /10\. SSIS-109\n片名10/);
});

test("when the site cannot be read the owner is told, not left waiting", async () => {
  const h = harness({ site: () => ({ status: 403, body: "" }) });
  const out = await runDaily(baseEnv, h.fetcher);
  assert.equal(out.pushed, true);
  assert.equal(out.ok, false);
  assert.match(h.sent[0].body.messages[0].text, /今天抓不到[\s\S]*HTTP 403/);
});

test("a partial ranking is still pushed with a warning", async () => {
  const h = harness({ site: () => ({ status: 200, body: html(6) }) });
  const out = await runDaily(baseEnv, h.fetcher);
  assert.equal(out.count, 6);
  assert.match(h.sent[0].body.messages[0].text, /只解析到 6 筆/);
});

test("without a valid owner ID the ranking is broadcast to every friend", async () => {
  for (const owner of ["", undefined, "not-an-id"]) {
    const h = harness();
    const out = await runDaily({ ...baseEnv, OWNER_LINE_USER_ID: owner }, h.fetcher);
    assert.deepEqual({ ...out, text: undefined }, { pushed: true, mode: "broadcast", ok: true, count: 10, text: undefined });
    assert.equal(h.sent[0].url, "/v2/bot/message/broadcast");
    assert.equal("to" in h.sent[0].body, false);
    assert.match(h.sent[0].body.messages[0].text, /TOP 10/);
  }
});

test("nothing is sent without a channel token", async () => {
  const h = harness();
  assert.deepEqual(await runDaily({ ...baseEnv, LINE_CHANNEL_ACCESS_TOKEN: "" }, h.fetcher), { pushed: false, reason: "not-configured" });
  assert.equal(h.sent.length, 0);
});

test("a transient LINE error is retried once; a client error is not", async () => {
  let n = 0;
  const h = harness({ line: () => (++n === 1 ? 500 : 200) });
  const realSetTimeout = globalThis.setTimeout; globalThis.setTimeout = (fn) => realSetTimeout(fn, 0);
  try {
    await pushText(baseEnv, h.fetcher, OWNER, "x");
    assert.equal(h.sent.length, 2);
    const bad = harness({ line: () => 400 });
    await assert.rejects(() => pushText(baseEnv, bad.fetcher, OWNER, "x"), /LINE request failed: 400/);
    assert.equal(bad.sent.length, 1);
  } finally { globalThis.setTimeout = realSetTimeout; }
});

test("scheduled() runs the daily push using the scheduled time", async () => {
  const h = harness();
  await createWorker({ fetcher: h.fetcher }).scheduled({ scheduledTime: Date.parse("2026-10-23T00:00:00Z") }, baseEnv);
  assert.match(h.sent[0].body.messages[0].text, /2026-10-23 08:00/);
});

test("health check reports configuration without secrets", async () => {
  const worker = createWorker();
  const r = await worker.fetch(new Request("https://x/"), baseEnv);
  const body = await r.json();
  assert.equal(body.owner_configured, true);
  assert.equal(body.schedule, "08:00 Asia/Taipei");
  assert.ok(!JSON.stringify(body).includes(OWNER) && !JSON.stringify(body).includes("tok"));
  assert.equal((await (await worker.fetch(new Request("https://x/"), {})).json()).owner_configured, false);
});

test("the webhook rejects bad signatures and unknown paths", async () => {
  const h = harness(); const worker = createWorker({ fetcher: h.fetcher });
  assert.equal((await callback(worker, baseEnv, [event("排行")], "wrong")).status, 401);
  assert.equal((await worker.fetch(new Request("https://x/callback", { method: "POST", body: "{}" }), baseEnv)).status, 401);
  assert.equal((await worker.fetch(new Request("https://x/other"), baseEnv)).status, 404);
  assert.equal((await callback(worker, baseEnv, [])).status, 200, "LINE's empty verification request");
  assert.equal(h.sent.length, 0);
  assert.equal(await verifySignature("{}", "!!!", SECRET), false);
});

test("anyone can ask for their own ID, which is how the owner is configured", async () => {
  const h = harness(); const worker = createWorker({ fetcher: h.fetcher });
  await callback(worker, { ...baseEnv, OWNER_LINE_USER_ID: "" }, [event("我的ID", OTHER)]);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].url, "/v2/bot/message/reply");
  assert.match(h.sent[0].body.messages[0].text, new RegExp(OTHER));
  assert.match(h.sent[0].body.messages[0].text, /所有好友都會收到/);
});

test("asking for the ranking replies with the copy saved today, without fetching anything", async () => {
  const h = harness(); const worker = createWorker({ fetcher: h.fetcher });
  const env = { ...baseEnv, LATEST: kv({ text: "📊 今日熱門 TOP 10\n1. A", savedAt: Date.now() }) };
  await callback(worker, env, [event("排行", OWNER)]);
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].url, "/v2/bot/message/reply");
  assert.equal(h.sent[0].body.messages[0].text, "📊 今日熱門 TOP 10\n1. A");
});

test("an older saved copy is labelled with its date; nothing saved says so", async () => {
  const h = harness(); const worker = createWorker({ fetcher: h.fetcher });
  await callback(worker, { ...baseEnv, LATEST: kv({ text: "OLD", savedAt: Date.parse("2026-10-01T00:00:00Z") }) }, [event("排行", OWNER)]);
  assert.match(h.sent[0].body.messages[0].text, /這是 2026-10-01 的排行，今天的還沒更新[\s\S]*OLD/);
  await callback(worker, { ...baseEnv, LATEST: kv() }, [event("排行", OWNER)]);
  assert.match(h.sent[1].body.messages[0].text, /還沒有收到排行資料/);
});

test("only the owner can ask for the ranking when an owner is set", async () => {
  const h = harness(); const worker = createWorker({ fetcher: h.fetcher });
  const env = { ...baseEnv, LATEST: kv({ text: "X", savedAt: Date.now() }) };
  await callback(worker, env, [event("排行", OTHER)]);
  await callback(worker, env, [event("hello", OTHER)]);
  assert.equal(h.sent.length, 0, "strangers get no reply and no data");
});

test("the home computer can save the latest ranking, only with the channel token", async () => {
  const worker = createWorker(); const LATEST = kv(); const env = { ...baseEnv, LATEST };
  const post = (headers, body = JSON.stringify({ text: "RANK" })) => worker.fetch(new Request("https://x/latest", { method: "POST", headers, body }), env);
  assert.equal((await post({})).status, 401);
  assert.equal((await post({ Authorization: "Bearer wrong" })).status, 401);
  assert.equal(LATEST.store.size, 0);
  assert.equal((await post({ Authorization: "Bearer tok" }, "not json")).status, 400);
  assert.equal((await post({ Authorization: "Bearer tok" }, JSON.stringify({ text: "" }))).status, 400);
  assert.equal((await post({ Authorization: "Bearer tok" })).status, 200);
  assert.equal(JSON.parse(LATEST.store.get("latest")).text, "RANK");
  const noKv = await worker.fetch(new Request("https://x/latest", { method: "POST", headers: { Authorization: "Bearer tok" }, body: "{}" }), baseEnv);
  assert.equal(noKv.status, 401);
});

test("the owner gets a short help text for anything else; groups and non-text events are ignored", async () => {
  const h = harness(); const worker = createWorker({ fetcher: h.fetcher });
  await callback(worker, baseEnv, [event("你好", OWNER)]);
  assert.match(h.sent[0].body.messages[0].text, /每天早上 8 點/);
  const n = h.sent.length;
  await callback(worker, baseEnv, [
    { ...event("排行", OWNER), source: { type: "group", userId: OWNER, groupId: "G" } },
    { type: "follow", replyToken: "r", source: { type: "user", userId: OWNER } },
    { ...event("排行", OWNER), mode: "standby" },
    { type: "message", replyToken: "r", source: { type: "user", userId: OWNER }, message: { type: "image" } },
  ]);
  assert.equal(h.sent.length, n);
});

test("a failed LINE reply is reported so LINE can redeliver", async () => {
  const h = harness({ line: () => 500 }); const worker = createWorker({ fetcher: h.fetcher });
  assert.equal((await callback(worker, baseEnv, [event("排行", OWNER)])).status, 500);
});
