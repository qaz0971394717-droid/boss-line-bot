import test from "node:test";
import assert from "node:assert/strict";
import {
  blockedReason, cleanTitle, codeFromHref, decodeEntities,
  fetchRanking, formatRanking, parseRanking,
} from "../src/ranking.js";

const BASE = "https://example.test/cn/today-hot";

// NOTE: these pages are synthetic. They model common layouts but are NOT copies of the real
// site, which could not be reached while this was written. They prove the extraction logic,
// not that the real page still has this shape.
const cards = (n, start = 100) =>
  Array.from({ length: n }, (_, i) =>
    `<div class="card"><a href="/cn/ssis-${start + i}" alt="SSIS-${start + i} 片名${i + 1}"><img src="x.jpg" alt="SSIS-${start + i} 片名${i + 1}"></a></div>`,
  ).join("\n");
const page = (inner) => `<html><body><nav><a href="/cn/today-hot">今日熱門</a><a href="/cn/new">新作</a><a href="/cn/weekly-hot">本週</a></nav>${inner}</body></html>`;

test("codes are taken from the link and normalised", () => {
  const code = (h) => codeFromHref(h, BASE);
  assert.equal(code("/cn/ssis-123"), "SSIS-123");
  assert.equal(code("https://example.test/cn/ABP-1234"), "ABP-1234");
  assert.equal(code("/cn/ssis-123-uncensored-leak"), "SSIS-123");
  assert.equal(code("/cn/fc2-ppv-1234567"), "FC2-PPV-1234567");
  assert.equal(code("/cn/010123_001"), "010123-001");
  assert.equal(code("/cn/today-hot"), null);
  assert.equal(code("/cn/new"), null);
  assert.equal(code("/cn/search?q=ssis-123"), null);
  assert.equal(code("http://[bad"), null);
});

test("entities are decoded and titles lose the repeated code", () => {
  assert.equal(decodeEntities("A &amp; B &#39;x&#39; &quot;y&quot; &#x4e2d;"), "A & B 'x' \"y\" 中");
  assert.equal(decodeEntities("&#99999999999;"), "");
  assert.equal(cleanTitle("SSIS-123 標題", "SSIS-123"), "標題");
  assert.equal(cleanTitle("ssis123：標題", "SSIS-123"), "標題");
  assert.equal(cleanTitle("標題 SSIS-123", "SSIS-123"), "標題 SSIS-123");
});

test("a Jable-style listing parses: image link without alt, then a title link", () => {
  const html = Array.from({ length: 3 }, (_, i) =>
    `<div class="video-img-box"><div class="img-box"><a href="https://jable.tv/videos/ssis-30${i}/"><img data-src="x.jpg"></a></div><div class="detail"><h6 class="title"><a href="https://jable.tv/videos/ssis-30${i}/">SSIS-30${i} 標題${i}</a></h6></div></div>`).join("");
  const items = parseRanking(page(html), "https://jable.tv/hot/");
  assert.deepEqual(items.map((i) => i.code), ["SSIS-300", "SSIS-301", "SSIS-302"]);
  assert.deepEqual(items.map((i) => i.title), ["標題0", "標題1", "標題2"]);
});

test("a poster link that only shows the running time does not become the title", () => {
  const html = page(
    `<a href="/videos/snos-363/"><img data-src="x"><span class="label">2:04:29</span></a>` +
    `<h6><a href="/videos/snos-363/">SNOS-363 真正的片名</a></h6>` +
    `<a href="/videos/adn-799/"><span>2:34:04</span></a>`,
  );
  assert.deepEqual(parseRanking(html, "https://jable.tv/hot/"), [{ code: "SNOS-363", title: "真正的片名" }]);
});

test("the first ten distinct codes are returned in page order, navigation ignored", () => {
  const items = parseRanking(page(cards(14)), BASE);
  assert.equal(items.length, 10);
  assert.deepEqual(items.map((i) => i.code), Array.from({ length: 10 }, (_, i) => `SSIS-${100 + i}`));
  assert.equal(items[0].title, "片名1");
});

test("duplicates are removed and later sections do not push earlier ones out", () => {
  const html = page(cards(3) + cards(3) + `<a href="/cn/abp-999"><img alt="ABP-999 其他"></a>`);
  const items = parseRanking(html, BASE);
  assert.deepEqual(items.map((i) => i.code), ["SSIS-100", "SSIS-101", "SSIS-102", "ABP-999"]);
});

test("titles come from image alt, the title attribute or the link text", () => {
  const html = page(
    `<a href="/cn/aaa-111"><img alt="AAA-111 圖片標題"></a>` +
    `<a href="/cn/bbb-222" title="BBB-222 屬性標題">x</a>` +
    `<a href="/cn/ccc-333">CCC-333 &amp; 文字標題</a>`,
  );
  assert.deepEqual(parseRanking(html, BASE).map((i) => i.title), ["圖片標題", "屬性標題", "& 文字標題"]);
});

test("links with no image and no readable title are skipped", () => {
  assert.deepEqual(parseRanking(page(`<a href="/cn/page-10"></a><a href="/cn/zzz-12"> </a>`), BASE), []);
});

test("fewer than ten and none are both handled", () => {
  assert.equal(parseRanking(page(cards(4)), BASE).length, 4);
  assert.deepEqual(parseRanking("<html></html>", BASE), []);
  assert.deepEqual(parseRanking("", BASE), []);
});

test("blocked pages are recognised from status or body", () => {
  assert.match(blockedReason(403, ""), /HTTP 403/);
  assert.match(blockedReason(503, ""), /HTTP 503/);
  assert.match(blockedReason(429, ""), /HTTP 429/);
  assert.match(blockedReason(200, "<title>Just a moment...</title>"), /防機器人/);
  assert.match(blockedReason(404, ""), /HTTP 404/);
  assert.equal(blockedReason(200, "<html>ok</html>"), null);
});

const res = (status, body, url) => ({ status, ok: status < 400, url, text: async () => body });

test("fetchRanking returns items from the first source that works", async () => {
  const calls = [];
  const fetcher = async (url) => { calls.push(url); return res(200, page(cards(10)), url); };
  const r = await fetchRanking({}, fetcher);
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 10);
  assert.equal(calls.length, 1);
});

test("fetchRanking falls back to the next source when the first is blocked", async () => {
  const calls = [];
  const fetcher = async (url) => { calls.push(url); return url.includes("missav.ws") ? res(403, "", url) : res(200, page(cards(10)), url); };
  const r = await fetchRanking({ RANKING_SOURCE_URL: "https://missav.ws/a, https://other.test/b" }, fetcher);
  assert.equal(r.ok, true);
  assert.equal(calls.length, 2, "a blocked page is not retried");
});

test("fetchRanking explains every failure when nothing works", async () => {
  const fetcher = async (url) => res(403, "", url);
  const r = await fetchRanking({}, fetcher);
  assert.equal(r.ok, false);
  assert.match(r.reason, /網站拒絕存取（HTTP 403）/);
});

test("a configured source URL replaces the defaults", async () => {
  const calls = [];
  const fetcher = async (url) => { calls.push(url); return res(200, page(cards(10)), url); };
  await fetchRanking({ RANKING_SOURCE_URL: "https://my.test/hot" }, fetcher);
  assert.deepEqual(calls, ["https://my.test/hot"]);
});

test("a changed page layout is reported as such", async () => {
  const fetcher = async (url) => res(200, "<html><body>nothing here</body></html>", url);
  const r = await fetchRanking({ RANKING_SOURCE_URL: "https://my.test/hot" }, fetcher);
  assert.equal(r.ok, false);
  assert.match(r.reason, /找不到影片清單/);
  const gated = await fetchRanking({ RANKING_SOURCE_URL: "https://my.test/hot" }, async (url) => res(200, "<html><title>Age &amp; verify</title></html>", url));
  assert.match(gated.reason, /頁面標題：Age & verify/);
});

test("a network error is retried once before giving up", async () => {
  let n = 0;
  const fetcher = async (url) => { if (++n === 1) throw Object.assign(new Error("x"), { name: "TypeError" }); return res(200, page(cards(10)), url); };
  const r = await fetchRanking({ RANKING_SOURCE_URL: "https://my.test/hot" }, fetcher);
  assert.equal(r.ok, true);
  assert.equal(n, 2);
});

const NOW = new Date("2026-10-22T00:00:00Z");

test("the message lists ten lines with number, code and title", () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ code: `SSIS-${100 + i}`, title: `標題${i + 1}` }));
  const text = formatRanking({ ok: true, items }, { now: NOW });
  const lines = text.split("\n");
  assert.equal(lines[0], "📊 今日熱門 TOP 10");
  assert.equal(lines[1], "2026-10-22 08:00");
  assert.equal(lines.filter((l) => /^\d+\. /.test(l)).length, 10);
  assert.equal(lines[3], "1. SSIS-100｜標題1");
  assert.equal(lines[12], "10. SSIS-109｜標題10");
  assert.doesNotMatch(text, /http/);
});

test("long titles are shortened and a partial result is flagged", () => {
  const text = formatRanking({ ok: true, items: [{ code: "AAA-111", title: "長".repeat(200) }] }, { now: NOW });
  assert.match(text, /1\. AAA-111｜長{79}…/);
  assert.match(text, /只解析到 1 筆（預期 10 筆）/);
});

test("a failure message says why and never contains an empty ranking", () => {
  const text = formatRanking({ ok: false, reason: "missav.ws：網站拒絕存取（HTTP 403）" }, { now: NOW });
  assert.match(text, /今天抓不到/);
  assert.match(text, /HTTP 403/);
  assert.doesNotMatch(text, /1\. /);
});
