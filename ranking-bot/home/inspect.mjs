// Saves the raw pages of the first ranked video and its actress, so the parser can be built from real HTML.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { chromium } from "playwright-core";
import { parseRanking } from "../src/ranking.js";

const here = dirname(fileURLToPath(import.meta.url));
const env = { ...process.env };
try {
  for (const line of readFileSync(join(here, ".env"), "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) env[m[1]] ??= m[2];
  }
} catch {}

const browser = await chromium.launch({
  headless: false,
  ...(env.CHROME_PATH ? { executablePath: env.CHROME_PATH } : { channel: "chrome" }),
  args: env.SHOW_BROWSER === "1" ? [] : ["--window-position=-2400,-2400", "--window-size=1280,800", "--start-minimized", "--mute-audio"],
});
const page = await browser.newPage({ locale: "zh-TW" });
const open = async (url, file) => {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  for (let i = 0; i < 10 && /Just a moment|Attention Required/i.test(await page.title()); i++) await page.waitForTimeout(2000);
  const html = await page.content();
  writeFileSync(join(here, file), html);
  console.log("saved", file, html.length, "bytes -", await page.title());
  return html;
};
try {
  const hotUrl = (env.RANKING_SOURCE_URL || "https://jable.tv/hot/").split(",")[0].trim();
  const hot = await open(hotUrl, "sample-hot.html");
  const first = parseRanking(hot, hotUrl, 1)[0];
  if (!first?.url) throw new Error("ranking page had no videos");
  const video = await open(first.url, "sample-video.html");
  const model = /href="([^"]*\/models\/[^"]*)"/i.exec(video)?.[1];
  if (model) await open(new URL(model, first.url).href, "sample-model.html");
  else console.log("video page has no /models/ link");
} catch (error) {
  console.error("failed:", error?.message || error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
