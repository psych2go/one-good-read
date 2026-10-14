const DEFAULT_LIMIT = 2_000_000;
const MAX_REDIRECTS = 10;

export class HttpFetchError extends Error {
  constructor(readonly status: number, readonly url: string, readonly retryAfter?: string) { super(`Fetch failed ${status} for ${url}`); }
}

/** Squarespace and similar hosts 302 to the same URL while setting a crumb cookie; Workers'
 * redirect:"follow" does not replay Set-Cookie, so the loop becomes "Too many redirects". */
export async function fetchBoundedText(url: string, init: RequestInit = {}, maxBytes = DEFAULT_LIMIT): Promise<{ text: string; response: Response }> {
  const response = await fetchFollowingRedirects(url, {
    ...init,
    headers: {
      "User-Agent": "OneGoodRead/0.1 (+https://github.com/one-good-read)",
      Accept: "text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.5",
      ...init.headers,
    },
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new HttpFetchError(response.status, url, response.headers.get("retry-after") ?? undefined);
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error(`Response exceeds ${maxBytes} bytes for ${url}`);
  if (!response.body) return { text: "", response };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("response too large");
      throw new Error(`Response exceeds ${maxBytes} bytes for ${url}`);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(merged), response };
}

async function fetchFollowingRedirects(url: string, init: RequestInit): Promise<Response> {
  let current = url;
  const cookies = new Map<string, string>();
  const { headers: initHeaders, redirect: _ignored, ...rest } = init;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const headers = new Headers(initHeaders);
    if (cookies.size) headers.set("Cookie", [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join("; "));
    const response = await fetch(current, { ...rest, headers, redirect: "manual" });
    collectCookies(response.headers, cookies);
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    current = new URL(location, current).href;
  }
  throw new Error(`Too many redirects (${MAX_REDIRECTS}) for ${url}`);
}

function collectCookies(headers: Headers, jar: Map<string, string>): void {
  const fromGetter = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const single = headers.get("set-cookie");
  const entries = fromGetter.length ? fromGetter : single ? [single] : [];
  for (const entry of entries) {
    const pair = entry.split(";", 1)[0] ?? "";
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
}
