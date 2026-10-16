// Do not retry mutating API requests here: the remote side may have accepted
// a request even when its response never arrived.
export const API_TIMEOUT_MS = 5000;

export async function fetchWithTimeout(url, options = {}, fetcher = fetch, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Workers runtime supports manual redirects consistently; never forward credentials.
    const response = await fetcher(url, { ...options, signal: controller.signal, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) throw new TypeError("HTTP redirect rejected");
    return response;
  } finally {
    clearTimeout(timer);
  }
}
