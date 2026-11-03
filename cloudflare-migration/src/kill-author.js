import { fetchWithTimeout } from "./http.js";

const KILL_COMMAND = /^(K\s+\S|KBKILL\s+\S)/i;

export function isKillCommand(command) {
  return KILL_COMMAND.test(String(command || "").trim());
}

function profileUrl(source) {
  const userId = encodeURIComponent(source.userId);
  if (source.type === "group" && source.groupId) return `https://api.line.me/v2/bot/group/${encodeURIComponent(source.groupId)}/member/${userId}`;
  if (source.type === "room" && source.roomId) return `https://api.line.me/v2/bot/room/${encodeURIComponent(source.roomId)}/member/${userId}`;
  return `https://api.line.me/v2/bot/profile/${userId}`;
}

export async function fetchDisplayName(source, env, fetcher = fetch) {
  if (!source?.userId || !env.LINE_CHANNEL_ACCESS_TOKEN) return "";
  try {
    const res = await fetchWithTimeout(profileUrl(source), { headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` } }, fetcher, 2000);
    if (!res.ok) return "";
    const name = (await res.json())?.displayName;
    return typeof name === "string" ? name.trim().slice(0, 40) : "";
  } catch {
    return "";
  }
}

// Adds "｜K單：name" to the first line of a successful kill reply; leaves any warning lines untouched.
export async function addKillAuthor(reply, command, source, env, fetcher = fetch) {
  if (!reply || reply.type !== "text" || !reply.text.startsWith("✅") || !isKillCommand(command)) return reply;
  const name = await fetchDisplayName(source, env, fetcher);
  if (!name) return reply;
  const lineEnd = reply.text.indexOf("\n");
  const first = lineEnd === -1 ? reply.text : reply.text.slice(0, lineEnd);
  const rest = lineEnd === -1 ? "" : reply.text.slice(lineEnd);
  return { ...reply, text: `${first}｜K單：${name}${rest}` };
}
