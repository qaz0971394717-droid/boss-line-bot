// Looks the actresses up on Japanese Wikipedia and prints the height / measurement lines it finds.
const NAMES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["雛形みくる", "雛形美久流", "海老咲碧", "宇野小春", "彩月七緒", "安達夕莉", "小笠原菜乃"];
const API = "https://ja.wikipedia.org/w/api.php";
const headers = { "User-Agent": "personal-ranking-bot/1.0 (home use)" };
const get = async (params) => {
  const r = await fetch(API + "?" + new URLSearchParams({ format: "json", ...params }), { headers, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
};
for (const name of NAMES) {
  try {
    const found = await get({ action: "query", list: "search", srsearch: name, srlimit: "3" });
    const hit = found.query?.search?.[0];
    if (!hit) { console.log(`${name}: Wikipedia 找不到`); continue; }
    const page = await get({ action: "query", prop: "revisions", rvprop: "content", rvslots: "main", titles: hit.title });
    const text = Object.values(page.query.pages)[0]?.revisions?.[0]?.slots?.main?.["*"] ?? "";
    const lines = text.split("\n").filter((l) => /身長|スリーサイズ|サイズ|カップ|B\s*\d{2}|T\s*\d{3}/.test(l)).slice(0, 4);
    console.log(`${name} -> 條目「${hit.title}」`);
    console.log(lines.length ? lines.map((l) => "   " + l.trim().slice(0, 120)).join("\n") : "   （條目裡沒有身高三圍）");
  } catch (error) {
    console.log(`${name}: 查詢失敗 ${error.message}`);
  }
}
