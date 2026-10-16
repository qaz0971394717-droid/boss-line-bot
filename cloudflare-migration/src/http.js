// Do not retry mutating API requests here: the remote side may have accepted
// a request even when its response never arrived.
export const API_TIMEOUT_MS = 5000;

export async function fetchWithTimeout(url, options = {}, fetcher = fetch, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { ...options, signal: controller.signal, redirect: "error" });
  } finally {
    clearTimeout(timer);
  }
}
