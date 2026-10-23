// Runs on your own computer: fetches the ranking from your home connection and sends it to LINE.
// Usage:  node home/run.mjs          send now
//         node home/run.mjs --dry    only print the message, send nothing
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright-core";
import { buildMessage, runDaily } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const env = { ...process.env };
try {
  for (const line of readFileSync(join(here, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  console.error("找不到 home/.env，請照說明建立。");
  process.exit(2);
}

// The site refuses plain HTTP clients even from a home connection, so the ranking page is
// opened in a real Chrome (installed on this computer) and LINE calls use normal fetch.
let browser;
async function browserFetch(url, init) {
  if (/line\.me|127\.0\.0\.1:\d+\/v2/.test(url) || env.LINE_API_BASE && url.startsWith(env.LINE_API_BASE)) return fetch(url, init);
  browser ??= await chromium.launch({
    headless: false, // the site only lets a real (non-headless) Chrome through
    // keep the window off-screen so it does not interrupt; SHOW_BROWSER=1 brings it back on screen
    args: env.SHOW_BROWSER === "1" ? [] : ["--window-position=-2400,-2400", "--window-size=1280,800", "--start-minimized", "--mute-audio"],
    ...(env.CHROME_PATH ? { executablePath: env.CHROME_PATH } : { channel: "chrome" }),
  });
  const page = await browser.newPage({ locale: "zh-TW" });
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    // give an anti-bot "checking your browser" page a chance to finish
    for (let i = 0; i < 10 && /Just a moment|請稍候|Attention Required/i.test(await page.title()); i++) await page.waitForTimeout(2000);
    const status = /Just a moment|Attention Required/i.test(await page.title()) ? 403 : response?.status() ?? 0;
    const body = await page.content();
    return { status, ok: status < 400, url: page.url(), text: async () => body };
  } finally {
    await page.close();
  }
}

// Codes sent in the last SKIP_DAYS days are not sent again.
const SENT_FILE = join(here, "sent.json");
const SKIP_DAYS = 7;
const DAY = 86400000;
let sent = {};
try {
  sent = JSON.parse(readFileSync(SENT_FILE, "utf8"));
} catch {}
const exclude = new Set(Object.entries(sent).filter(([, at]) => Date.now() - at < SKIP_DAYS * DAY).map(([code]) => code));

try {
  if (process.argv.includes("--dry")) {
    const { text } = await buildMessage(env, browserFetch, new Date(), { exclude });
    console.log(text);
  } else {
    const out = await runDaily(env, browserFetch, new Date(), { exclude });
    console.log(JSON.stringify({ ...out, text: undefined, codes: undefined }));
    if (out.pushed && out.ok) {
      const now = Date.now();
      for (const code of out.codes) sent[code] = now;
      for (const [code, at] of Object.entries(sent)) if (now - at > 3 * SKIP_DAYS * DAY) delete sent[code];
      writeFileSync(SENT_FILE, JSON.stringify(sent));
    }
    if (!out.pushed) process.exitCode = 2;
    // leave a copy in the cloud so typing "排行" in LINE shows today's list
    if (out.ok) {
      try {
        const base = env.RANKING_WORKER_URL || "https://daily-ranking-bot.qaz0971394717.workers.dev";
        const saved = await fetch(base + "/latest", {
          method: "POST",
          headers: { Authorization: "Bearer " + env.LINE_CHANNEL_ACCESS_TOKEN, "Content-Type": "application/json" },
          body: JSON.stringify({ text: out.text }),
          signal: AbortSignal.timeout(15000),
        });
        console.log("存到雲端：", saved.ok ? "成功" : "失敗 HTTP " + saved.status);
      } catch (error) {
        console.error("存到雲端失敗：", error?.message || error);
      }
    }
  }
} catch (error) {
  console.error("執行失敗：", error?.message || error);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
