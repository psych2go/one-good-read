import { describe, expect, it } from "vitest";
import { findBloombergUrl, parseEmailIngestPayload, syntheticMoneyStuffUrl } from "../src/sources/email-ingest";
import { MoneyStuffAdapter } from "../src/sources/money-stuff";
import { isIngestBearerAuthorized } from "../src/security/ingest-auth";

describe("email ingest payload parser", () => {
  it("requires money-stuff source and a body", () => {
    expect(parseEmailIngestPayload({ sourceId: "paul-graham", messageId: "1", subject: "x", textBody: "hi" }).ok).toBe(false);
    expect(parseEmailIngestPayload({ sourceId: "money-stuff", messageId: "1", subject: "x" }).ok).toBe(false);
  });

  it("accepts externalId alias and prefers explicit canonicalUrl", () => {
    const parsed = parseEmailIngestPayload({
      sourceId: "money-stuff",
      externalId: "abc-123",
      subject: "Money Stuff: Banks",
      author: "Matt Levine",
      publishedAt: "2026-10-13T12:00:00.000Z",
      htmlBody: "<p>Body with <a href=\"https://www.bloomberg.com/opinion/articles/2026-10-13/other\">other</a></p>",
      canonicalUrl: "https://www.bloomberg.com/opinion/articles/2026-10-13/banks?utm_source=newsletter",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.messageId).toBe("abc-123");
    expect(parsed.article.sourceId).toBe("money-stuff");
    expect(parsed.article.canonicalUrl).toBe("https://www.bloomberg.com/opinion/articles/2026-10-13/banks");
    expect(parsed.article.inlineHtml).toContain("other");
  });

  it("extracts Bloomberg URL from HTML when canonicalUrl is omitted", () => {
    const parsed = parseEmailIngestPayload({
      sourceId: "money-stuff",
      messageId: "msg-1",
      subject: "Money Stuff",
      htmlBody: '<p>Read online: <a href="https://www.bloomberg.com/opinion/articles/2026-10-12/foo?utm_medium=email&amp;utm_source=nl">link</a></p><p>Essay text</p>',
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.article.canonicalUrl).toContain("bloomberg.com/opinion/articles/2026-10-12/foo");
    expect(parsed.article.canonicalUrl).not.toContain("utm_");
  });

  it("falls back to a synthetic identity URL", () => {
    const parsed = parseEmailIngestPayload({
      sourceId: "money-stuff",
      messageId: "<unique@bloomberg.com>",
      subject: "Money Stuff",
      textBody: "No bloomberg link here, just newsletter text.",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.article.canonicalUrl).toBe(syntheticMoneyStuffUrl("<unique@bloomberg.com>"));
    expect(parsed.article.author).toBe("Matt Levine");
  });
});

describe("bloomberg URL finder", () => {
  it("ignores non-bloomberg links", () => {
    expect(findBloombergUrl('<a href="https://example.com/x">x</a>')).toBeUndefined();
    expect(findBloombergUrl("https://www.bloomberg.com/newsletters/money-stuff/2026-10-13")).toContain("bloomberg.com");
  });
});

describe("MoneyStuffAdapter", () => {
  it("discovers nothing (push-only)", async () => {
    expect(await new MoneyStuffAdapter().discover()).toEqual([]);
  });

  it("extracts newsletter HTML into article text", async () => {
    const adapter = new MoneyStuffAdapter();
    const article = await adapter.extract({
      sourceId: "money-stuff",
      canonicalUrl: "https://www.bloomberg.com/opinion/articles/2026-10-13/example",
      title: "Money Stuff: Example",
      author: "Matt Levine",
      inlineHtml: `<p>${"markets ".repeat(80)}</p><p><a href="https://www.bloomberg.com/x">more</a></p>`,
    });
    expect(article.wordCount).toBeGreaterThan(50);
    expect(article.externalLinkCount).toBe(1);
    expect(article.contentHash).toHaveLength(64);
  });
});

describe("ingest bearer auth", () => {
  it("accepts a matching bearer secret", () => {
    const env = { INGEST_EMAIL_SECRET: "test-secret" } as unknown as Env;
    expect(isIngestBearerAuthorized(new Request("https://read.example/api/ingest/email", { headers: { Authorization: "Bearer test-secret" } }), env)).toBe(true);
    expect(isIngestBearerAuthorized(new Request("https://read.example/api/ingest/email", { headers: { Authorization: "Bearer wrong" } }), env)).toBe(false);
    expect(isIngestBearerAuthorized(new Request("https://read.example/api/ingest/email"), env)).toBe(false);
  });
});
