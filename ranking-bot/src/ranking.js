// Fetches a "hot videos" ranking page and extracts the first distinct codes with their titles.
// The page layout is not under our control, so extraction is deliberately generic and every
// failure is reported with a reason instead of being hidden.

export const DEFAULT_URLS = ["https://jable.tv/hot/"];

const CODE_PATTERNS = [
  /^(fc2-ppv-\d{5,9})(?:-.*)?$/i,
  /^([a-z]{2,10}-\d{2,6})(?:-[a-z0-9-]+)?$/i,
  /^(\d{6}[-_]\d{2,4})(?:[-_][a-z0-9]+)*$/i,
];

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text) {
  return String(text ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function safeChar(code) {
  try {
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  } catch {
    return "";
  }
}

const stripTags = (html) => decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

function attr(attrs, name) {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return m ? (m[1] ?? m[2]) : null;
}

export function codeFromHref(href, base) {
  let path;
  try {
    path = new URL(href, base).pathname;
  } catch {
    return null;
  }
  let slug = path.split("/").filter(Boolean).pop() ?? "";
  try {
    slug = decodeURIComponent(slug);
  } catch {
    return null;
  }
  for (const pattern of CODE_PATTERNS) {
    const m = slug.match(pattern);
    if (m) return m[1].toUpperCase().replace(/_/g, "-");
  }
  return null;
}

export function cleanTitle(title, code) {
  let t = String(title ?? "").replace(/\s+/g, " ").trim();
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/-/g, "[-_ ]?");
  t = t.replace(new RegExp(`^${escaped}[\\s:：|｜\\-–—]*`, "i"), "").trim();
  return t;
}

export function parseRanking(html, base, limit = 10) {
  // Many sites link the same video twice (poster, then title); keep first-seen order and
  // take the title from whichever link has one.
  const found = new Map();
  const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchor.exec(html))) {
    const href = attr(m[1], "href");
    if (!href) continue;
    const code = codeFromHref(href, base);
    if (!code) continue;
    const img = m[2].match(/<img\b([^>]*)>/i);
    const raw =
      (img && (attr(img[1], "alt") || attr(img[1], "title"))) ||
      attr(m[1], "title") ||
      attr(m[1], "alt") ||
      stripTags(m[2]);
    let title = cleanTitle(decodeEntities(raw), code);
    // poster links often carry only the running time ("2:04:29"), which is not a title
    if (/^[\d:：\s]+$/.test(title)) title = "";
    // a bare navigation link has neither an image nor a readable title
    if (!img && title.length < 2) continue;
    const existing = found.get(code);
    if (!existing) found.set(code, { code, title, url: new URL(href, base).href });
    else if (!existing.title && title) existing.title = title;
  }
  return [...found.values()].filter((item) => item.title).slice(0, limit);
}

export function blockedReason(status, body) {
  if (status === 403 || status === 429 || status === 503 || status === 401)
    return `網站拒絕存取（HTTP ${status}），可能是防機器人機制`;
  if (/Just a moment|cf-challenge|Attention Required|Enable JavaScript and cookies/i.test(body ?? ""))
    return "網站回傳防機器人驗證頁面";
  if (status >= 400) return `網站回應錯誤（HTTP ${status}）`;
  return null;
}

// What the page actually said, so a changed layout or a gate page can be recognised from the alert.
export function pageHint(body) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body || "")?.[1];
  const text = decodeEntities(String(title || "").replace(/\s+/g, " ").trim());
  return text ? `（頁面標題：${text.slice(0, 60)}）` : "";
}

export async function fetchRanking(env, fetcher = fetch, limit = 10) {
  const configured = String(env.RANKING_SOURCE_URL || "").split(",").map((u) => u.trim()).filter(Boolean);
  const urls = configured.length ? configured : DEFAULT_URLS;
  const failures = [];
  for (const url of urls) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const response = await fetcher(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.5",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(10000),
        });
        const body = await response.text();
        const blocked = blockedReason(response.status, body);
        if (blocked) {
          failures.push(`${new URL(url).host}：${blocked}`);
          break; // retrying a blocked page only makes it worse
        }
        const items = parseRanking(body, response.url || url, limit);
        if (items.length) return { ok: true, items, url };
        failures.push(`${new URL(url).host}：頁面讀取成功但找不到影片清單（網站版面可能改了）${pageHint(body)}`);
        break;
      } catch (error) {
        failures.push(`${new URL(url).host}：連線失敗（${error?.name || "error"}）`);
        if (attempt === 2) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  return { ok: false, reason: failures.join("\n") || "沒有可用的來源網址" };
}

const taipei = (date) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);

export function formatRanking(result, { label = "今日熱門", now = new Date(), limit = 10 } = {}) {
  const stamp = taipei(now);
  if (!result.ok)
    return `⚠️ ${label} TOP ${limit}：今天抓不到\n${stamp}\n\n${result.reason}\n\n（沒有推播空的排行，網站恢復後會自動繼續）`;
  const lines = result.items.slice(0, limit).map((item, i) => {
    // code on its own line and a short title under it, so phone screens do not run entries together
    const title = item.title.length > 40 ? item.title.slice(0, 39) + "…" : item.title;
    return `${i + 1}. ${item.code}${title ? "\n" + title : ""}${item.url ? "\n" + item.url : ""}`;
  });
  const note = result.items.length < limit ? `\n\n⚠️ 只解析到 ${result.items.length} 筆（預期 ${limit} 筆），網站版面可能有變動。` : "";
  return `📊 ${label} TOP ${limit}\n${stamp}\n\n${lines.join("\n\n")}${note}`;
}
