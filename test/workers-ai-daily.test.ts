import { describe, expect, it, vi } from "vitest";
import { DAILY_MAX_TOKENS, WorkersAiProvider, isMalformedOutputError } from "../src/ai/workers-ai";
import type { RankedCandidate } from "../src/domain/types";

vi.mock("../src/ai/openai", async (original) => ({ ...await original<typeof import("../src/ai/openai")>(), wait: vi.fn(async () => undefined) }));

const winner = {
  articleId: "a1", title: "T", author: "A", canonicalUrl: "https://example.com", readingMinutes: 5,
  analysis: { articleId: "a1", analysisVersion: "v", provider: "p", model: "m", intrinsicScore: 8, scores: { longTermValue: 8, ideaDensity: 8, argumentQuality: 8, originality: 8, clarityStructure: 8 }, extractionConfidence: 1, analysisConfidence: 1, primaryTheme: "风险", secondaryThemes: [], keywords: [], evidence: [], riskNotes: [], contextSummary: "" },
  dynamicScore: 1, freshnessBonus: 0, explorationBonus: 0, authorPenalty: 0, themePenalty: 0, connectionBonus: 0, personalFit: 0, explanation: "",
} as RankedCandidate;
const good = { whyWorthReading: "x".repeat(60), whyToday: "y".repeat(40), keywords: ["a", "b", "c"] };

describe("Workers AI daily editor/copywriter calls", () => {
  it("requests 4096 tokens with low reasoning effort", async () => {
    const run = vi.fn(async () => ({ choices: [{ message: { content: JSON.stringify(good) } }] }));
    await new WorkersAiProvider({ run } as unknown as Ai, "@cf/openai/gpt-oss-120b").writeRecommendation(winner, "");
    expect(run).toHaveBeenCalledWith("@cf/openai/gpt-oss-120b", expect.objectContaining({ max_tokens: DAILY_MAX_TOKENS, reasoning_effort: "low" }), expect.anything());
    expect(DAILY_MAX_TOKENS).toBe(4096);
  });

  it("retries empty and truncated JSON, then succeeds", async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: "" } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"whyWorthReading":"abc' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(good) } }] });
    const copy = await new WorkersAiProvider({ run } as unknown as Ai, "m").writeRecommendation(winner, "");
    expect(copy).toEqual(good);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("gives up after three malformed attempts so the pipeline can fall back", async () => {
    const run = vi.fn(async () => ({ choices: [{ message: { content: "" } }] }));
    await expect(new WorkersAiProvider({ run } as unknown as Ai, "m").writeRecommendation(winner, "")).rejects.toThrow("did not contain JSON");
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("does not add malformed-output retries to article analysis calls", async () => {
    const run = vi.fn(async () => ({ choices: [{ message: { content: "" } }] }));
    await expect(new WorkersAiProvider({ run } as unknown as Ai, "m").analyze({ title: "t", author: "a", canonicalUrl: "u", text: "正文", extractionConfidence: 1 } as never, { articleId: "a1", analysisVersion: "v" } as never)).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("classifies malformed output errors", () => {
    expect(isMalformedOutputError(new SyntaxError("Unterminated string in JSON at position 168"))).toBe(true);
    expect(isMalformedOutputError(new Error("Workers AI response did not contain JSON text"))).toBe(true);
    expect(isMalformedOutputError(new Error("4006: daily free allocation exceeded"))).toBe(false);
  });
});
