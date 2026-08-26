import { describe, expect, it } from "vitest";
import { contentRejectionReason } from "../src/domain/content-gate";
import type { ExtractedArticle } from "../src/domain/types";

const base: ExtractedArticle = {
  sourceId: "marginal-revolution",
  canonicalUrl: "https://example.com/a",
  title: "A real essay",
  author: "Tyler Cowen",
  text: "word ".repeat(300),
  contentHash: "x",
  wordCount: 300,
  readingMinutes: 2,
  extractionConfidence: .98,
  externalLinkCount: 2,
};

describe("B2 content gate", () => {
  it("rejects assorted links", () => expect(contentRejectionReason({ ...base, title: "Tuesday assorted links" })).toBe("non_standalone_format"));
  it("keeps a concise standalone essay", () => expect(contentRejectionReason({ ...base, wordCount: 70, externalLinkCount: 0 })).toBeUndefined());
  it("rejects podcast URLs even when the page contains text", () => expect(contentRejectionReason({ ...base, canonicalUrl: "https://fs.blog/knowledge-project-podcast/example/" })).toBe("media_first"));
});
