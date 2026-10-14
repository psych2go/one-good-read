import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBoundedText } from "../src/sources/http";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("cookie-aware redirect following", () => {
  it("replays Set-Cookie across same-host redirects instead of looping", async () => {
    let hits = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      hits += 1;
      const headers = new Headers(init?.headers);
      const cookie = headers.get("Cookie") ?? "";
      if (!cookie.includes("crumb=ok")) {
        return new Response(null, { status: 302, headers: { Location: String(url), "Set-Cookie": "crumb=ok; Path=/; Secure" } });
      }
      return new Response("<rss></rss>", { status: 200, headers: { "Content-Type": "application/rss+xml" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { text } = await fetchBoundedText("https://www.ben-evans.com/benedictevans?format=rss");
    expect(text).toContain("<rss");
    expect(hits).toBe(2);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toBeTruthy();
    const secondHeaders = new Headers(fetchMock.mock.calls[1]![1]!.headers as HeadersInit);
    expect(secondHeaders.get("Cookie")).toContain("crumb=ok");
  });

  it("throws after the redirect hop limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(null, { status: 302, headers: { Location: String(url), "Set-Cookie": "crumb=loop; Path=/" } })));
    await expect(fetchBoundedText("https://example.test/loop")).rejects.toThrow(/Too many redirects/);
  });
});
