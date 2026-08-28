import { describe, expect, it } from "vitest";
import { RSS_SOURCE_CONFIGS } from "../src/sources/rss-config";
import { RssSourceAdapter } from "../src/sources/rss";

describe("deferred RSS extraction support", () => {
  it("is enabled only when a canonical page selector is configured", () => {
    const configured = RSS_SOURCE_CONFIGS.map((config) => new RssSourceAdapter(config));
    expect(configured.every((adapter) => adapter.supportsDeferredExtraction)).toBe(true);
    expect(new RssSourceAdapter({ sourceId: "marginal-revolution", feedUrl: "https://example.com/feed", defaultAuthor: "A" }).supportsDeferredExtraction).toBe(false);
  });
});
