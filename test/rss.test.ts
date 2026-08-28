import { describe, expect, it } from "vitest";
import { parseRssFeed, RssSourceAdapter } from "../src/sources/rss";

const feed = `<?xml version="1.0"?><rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>Thinking &amp; Doing</title><link>https://example.com/post</link><dc:creator>Scott Alexander</dc:creator><pubDate>Tue, 25 Aug 2026 16:03:47 GMT</pubDate><content:encoded><![CDATA[<p>A complete paragraph about decisions.</p><p>Another paragraph with <a href="https://example.org">evidence</a>.</p>]]></content:encoded></item></channel></rss>`;

describe("generic RSS source adapter", () => {
  it("parses namespaced full-content RSS items", () => {
    const items = parseRssFeed(feed, { sourceId: "astral-codex-ten", feedUrl: "https://example.com/feed", defaultAuthor: "Scott Alexander", allowedAuthors: ["Scott Alexander"] });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "Thinking & Doing", author: "Scott Alexander", link: "https://example.com/post" });
    expect(items[0]?.html).toContain("complete paragraph");
  });

  it("normalizes Blogger author identities", () => {
    const blogger = feed.replace("Scott Alexander", "noreply@blogger.com (Aswath Damodaran)");
    const items = parseRssFeed(blogger, { sourceId: "aswath-damodaran", feedUrl: "https://example.com/feed", defaultAuthor: "Aswath Damodaran", allowedAuthors: ["Aswath Damodaran"], normalizeAuthor: () => "Aswath Damodaran" });
    expect(items[0]?.author).toBe("Aswath Damodaran");
  });

  it("extracts text and counts links from inline feed HTML", async () => {
    const adapter = new RssSourceAdapter({ sourceId: "benedict-evans", feedUrl: "https://example.com/feed", defaultAuthor: "Benedict Evans" });
    const article = await adapter.extract({ sourceId: "benedict-evans", canonicalUrl: "https://example.com/post", title: "A standalone essay", author: "Benedict Evans", inlineHtml: `<p>${"idea ".repeat(120)}</p><p><a href="https://example.org">source</a></p>` });
    expect(article.wordCount).toBeGreaterThan(100);
    expect(article.externalLinkCount).toBe(1);
    expect(article.extractionConfidence).toBeGreaterThanOrEqual(.9);
  });
});

describe("historical feed pagination", () => {
  it("builds provider-specific historical page URLs", async () => {
    const { RSS_SOURCE_CONFIGS } = await import("../src/sources/rss-config");
    const byId = new Map(RSS_SOURCE_CONFIGS.map((config) => [config.sourceId, config]));
    expect(byId.get("aswath-damodaran")?.pageUrl?.(3)).toContain("start-index=21");
    expect(byId.get("benedict-evans")?.pageUrl?.(2)).toContain("page=2");
  });
});
