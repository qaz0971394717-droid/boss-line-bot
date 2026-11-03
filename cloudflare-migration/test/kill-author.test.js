import test from "node:test";
import assert from "node:assert/strict";
import { addKillAuthor, isKillCommand } from "../src/kill-author.js";

const env = { LINE_CHANNEL_ACCESS_TOKEN: "token" };
const group = { type: "group", groupId: "Cgroup", userId: "Uuser" };
const okFetch = (name, seen = []) => async (url, options) => { seen.push({ url, options }); return new Response(JSON.stringify({ displayName: name }), { status: 200 }); };

test("recognises kill commands only", () => {
  assert.equal(isKillCommand("K 公墓3"), true);
  assert.equal(isKillCommand("k 6gh 1033"), true);
  assert.equal(isKillCommand("KBKILL abc"), true);
  assert.equal(isKillCommand("KB"), false);
  assert.equal(isKillCommand("取消 公墓3"), false);
});

test("appends the group member name to a kill reply", async () => {
  const seen = [];
  const reply = await addKillAuthor({ type: "text", text: "✅ 公墓3 擊殺已記錄｜下次出生 11/04 10:03:17" }, "K 公墓3", group, env, okFetch("小明", seen));
  assert.equal(reply.text, "✅ 公墓3 擊殺已記錄｜下次出生 11/04 10:03:17｜K單：小明");
  assert.equal(seen[0].url, "https://api.line.me/v2/bot/group/Cgroup/member/Uuser");
  assert.equal(seen[0].options.headers.Authorization, "Bearer token");
});

test("keeps warning lines after the name", async () => {
  const reply = await addKillAuthor({ type: "text", text: "✅ 公墓3 擊殺已記錄｜下次出生 11/04 10:03:17\n⚠️ 提醒失敗" }, "K 公墓3", group, env, okFetch("小明"));
  assert.equal(reply.text, "✅ 公墓3 擊殺已記錄｜下次出生 11/04 10:03:17｜K單：小明\n⚠️ 提醒失敗");
});

test("uses the profile endpoint in a private chat", async () => {
  const seen = [];
  await addKillAuthor({ type: "text", text: "✅ x" }, "K x", { type: "user", userId: "Uuser" }, env, okFetch("小明", seen));
  assert.equal(seen[0].url, "https://api.line.me/v2/bot/profile/Uuser");
});

test("leaves the reply alone when the name cannot be fetched or it is not a kill", async () => {
  const base = { type: "text", text: "✅ 公墓3 擊殺已記錄｜下次出生 11/04 10:03:17" };
  assert.deepEqual(await addKillAuthor(base, "K 公墓3", group, env, async () => new Response("", { status: 404 })), base);
  assert.deepEqual(await addKillAuthor(base, "K 公墓3", group, env, async () => { throw new Error("down"); }), base);
  assert.deepEqual(await addKillAuthor(base, "K 公墓3", { type: "group", groupId: "C" }, env, okFetch("小明")), base);
  assert.deepEqual(await addKillAuthor(base, "KB", group, env, okFetch("小明")), base);
  assert.deepEqual(await addKillAuthor({ type: "text", text: "❌ 找不到 BOSS" }, "K 公墓3", group, env, okFetch("小明")), { type: "text", text: "❌ 找不到 BOSS" });
});
