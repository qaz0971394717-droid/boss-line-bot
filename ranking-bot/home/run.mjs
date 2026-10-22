// Runs on your own computer: fetches the ranking from your home connection and sends it to LINE.
// Usage:  node home/run.mjs          send now
//         node home/run.mjs --dry    only print the message, send nothing
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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

if (process.argv.includes("--dry")) {
  const { text } = await buildMessage(env, fetch);
  console.log(text);
} else {
  try {
    const out = await runDaily(env, fetch);
    console.log(JSON.stringify(out));
    if (!out.pushed) process.exit(2);
  } catch (error) {
    console.error("推播失敗：", error?.message || error);
    process.exit(1);
  }
}
