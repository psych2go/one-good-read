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

import { analysisContentRejectionReason, legacyContentRejectionReason, parseContentEligibility } from "../src/domain/content-gate";
import { abstractArticle, abstractRisk, quoteHeavyEssay, shortEssay, standalone } from "./fixtures/content";

describe("standalone eligibility independent of score", () => {
  it("does not classify an article about videos as media by title alone", () => expect(contentRejectionReason(abstractArticle)).toBeUndefined());
  it.each([shortEssay, quoteHeavyEssay])("allows body-grounded short or quote-heavy essay evidence", (body) => {
    expect(parseContentEligibility(standalone(body), body)?.format).toBe("standalone_essay");
  });
  it.each([undefined, null, {}, { ...standalone(), format: "yes" }, { ...standalone(), bodyEvidence: [] }, { ...standalone(), bodyEvidence: [2] }, { ...standalone(), reason: "" }, { ...standalone(), version: "future" }])("rejects malformed eligibility: %j", (value) => {
    expect(parseContentEligibility(value, shortEssay)).toBeUndefined();
  });
  it("requires literal evidence from supplied body", () => expect(parseContentEligibility(standalone(), "some other body")).toBeUndefined());
  it("content rejection does not consult numeric score", () => {
    expect(analysisContentRejectionReason({ contentEligibility: { ...standalone(), format: "abstract" }, intrinsicScore: 10 } as never)).toBe("content_review:abstract");
  });
});

describe("conservative legacy evidence screening", () => {
  it.each([
    [abstractRisk, 131],
    ["正文更接近论文摘要和转述，而非完整文章；缺少模型设定、推导过程、关键假设和经验或数值支持", 161],
    ["摘要没有说明样本规模、估计方法、平行趋势检验、出生前趋势或多重稳健性分析，因而无法充分评估识别假设。", 185],
    ["The provided text is mainly a quoted paper abstract with missing model details.", 131],
    ["The body is incomplete", 1500],
  ] as const)("rejects explicit nonstandalone evidence: %s", (note, wordCount) => {
    expect(legacyContentRejectionReason({ riskNotes: [note], contextSummary: "", wordCount })).toMatch(/^content_review:/);
  });
  it.each([
    ["“摘要通常不受版权保护”并不意味着抓取、访问、训练或违反网站服务条款没有其他法律风险", "讨论新闻摘要与知识产权", 1812],
    ["The essay quotes a paper abstract, then develops a critique of its assumptions.", "", 900],
    ["The argument is abstract, not empirical.", "", 60],
    ["文章主要讨论新闻摘要的版权，以及不完整合约的影响。", "", 1812],
    ["Some robustness details would strengthen the argument.", "", 70],
  ] as const)("preserves topic mentions/quote-heavy essays/short essays: %s", (note, contextSummary, wordCount) => {
    expect(legacyContentRejectionReason({ riskNotes: [note], contextSummary, wordCount })).toBeUndefined();
  });
});
