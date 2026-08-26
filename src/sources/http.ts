const DEFAULT_LIMIT = 2_000_000;

export async function fetchBoundedText(url: string, init: RequestInit = {}, maxBytes = DEFAULT_LIMIT): Promise<{ text: string; response: Response }> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": "OneGoodRead/0.1 (+https://github.com/one-good-read)",
      Accept: "text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.5",
      ...init.headers,
    },
    redirect: "follow",
    signal: init.signal ?? AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Fetch failed ${response.status} for ${url}`);
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
