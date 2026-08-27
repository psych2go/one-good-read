import { describe, expect, it } from "vitest";
import { normalizeArticleUrl } from "../src/domain/url";

describe("article URL normalization", () => {
  it("collapses HTML-encoded and ordinary RSS tracking URLs", () => {
    const encoded = "https://marginalrevolution.com/post.html?utm_source=rss&#038;utm_medium=rss&#038;utm_campaign=post";
    const ordinary = "https://marginalrevolution.com/post.html?utm_source=rss&utm_medium=rss&utm_campaign=post";
    expect(normalizeArticleUrl(encoded)).toBe("https://marginalrevolution.com/post.html");
    expect(normalizeArticleUrl(ordinary)).toBe(normalizeArticleUrl(encoded));
  });

  it("preserves meaningful parameters while sorting them deterministically", () => {
    expect(normalizeArticleUrl("https://example.com/read?z=2&utm_source=email&a=1#section"))
      .toBe("https://example.com/read?a=1&z=2");
  });

  it("removes common click identifiers", () => {
    expect(normalizeArticleUrl("https://example.com/read?fbclid=x&gclid=y&mc_cid=z"))
      .toBe("https://example.com/read");
  });
});
