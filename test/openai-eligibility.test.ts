import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiProvider } from "../src/ai/openai";
import { analysisContentRejectionReason } from "../src/domain/content-gate";
import { abstractArticle, abstractRisk, quoteHeavyEssay, shortEssay, standalone } from "./fixtures/content";

const provider = new OpenAiProvider("test-model", "local-test-placeholder", "https://local.test");
const context = { articleId: "article", analysisVersion: "blind-v1-context-v1" };
function response(eligibility: unknown, riskNotes: string[] = []) {
  return { longTermValue: 9, ideaDensity: 9, argumentQuality: 9, originality: 9, clarityStructure: 9, confidence: .9, evidence: ["body"], riskNotes, contentEligibility: eligibility };
}
function mockResponses(blind: unknown) {
  const mock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { text: { format: { name: string } } };
    const output = request.text.format.name === "article_context_analysis" ? { primaryTheme: "决策与判断", secondaryThemes: [], keywords: ["判断", "决策", "风险"], confidence: .9, contextSummary: "Context" } : blind;
    return Response.json({ output_text: JSON.stringify(output) });
  });
  vi.stubGlobal("fetch", mock); return mock;
}
afterEach(() => vi.unstubAllGlobals());

describe("OpenAI body-based eligibility contract", () => {
  it("abstract classification remains rejected despite high intrinsic scores; blind input omits author", async () => {
    const mock = mockResponses(response({ ...standalone(abstractArticle.text), format: "abstract", reason: "A quoted paper abstract followed only by attribution." }, [abstractRisk]));
    const analysis = await provider.analyze(abstractArticle, context);
    expect(analysis.intrinsicScore).toBe(9);
    expect(analysisContentRejectionReason(analysis)).toBe("content_review:abstract");
    const request = JSON.parse(String(mock.mock.calls[0]?.[1]?.body));
    expect(request.input[1].content[0].text).toBe(`正文：\n${abstractArticle.text}`);
    expect(request.text.format.schema.required).toContain("contentEligibility");
    expect(request.text.format.schema.properties.contentEligibility.required).toEqual(["version", "format", "reason", "bodyEvidence"]);
    expect(mock).toHaveBeenCalledTimes(2); // No following the paper link.
  });
  it.each([undefined, { format: "standalone_essay" }, { ...standalone(), bodyEvidence: ["invented quote"] }])("malformed/missing eligibility cannot silently pass: %j", async (eligibility) => {
    mockResponses(response(eligibility));
    const analysis = await provider.analyze(abstractArticle, context);
    expect(analysisContentRejectionReason(analysis)).toBe("content_review:invalid_or_missing_eligibility");
    expect(analysis.contentEligibility?.format).toBe("uncertain");
  });
  it.each([shortEssay, quoteHeavyEssay])("keeps validated short and quote-heavy essays eligible", async (body) => {
    mockResponses(response(standalone(body)));
    const analysis = await provider.analyze({ ...abstractArticle, text: body }, context);
    expect(analysisContentRejectionReason(analysis)).toBeUndefined();
  });
  it("validates long-article synthesis evidence against the actual body", async () => {
    const text = `${quoteHeavyEssay}\n`.repeat(30);
    const mock = mockResponses(response(standalone(text)));
    const analysis = await provider.analyze({ ...abstractArticle, text }, context);
    expect(mock.mock.calls.length).toBeGreaterThan(3);
    expect(analysisContentRejectionReason(analysis)).toBeUndefined();
    expect(mock.mock.calls.some((call) => String(call[1]?.body).includes("article_blind_synthesis"))).toBe(true);
  });
});
