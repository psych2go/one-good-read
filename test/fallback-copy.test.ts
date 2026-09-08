import { describe, expect, it } from "vitest";
import { fallbackRecommendationCopy } from "../src/ai/fallback-copy";
import { assertPublicRecommendationCopy } from "../src/ai/validate-copy";
import type { RankedCandidate } from "../src/domain/types";

function candidate(overrides: Partial<RankedCandidate> = {}): RankedCandidate {
  return {
    articleId: "article-1",
    title: "A Test Essay",
    author: "Test Author",
    canonicalUrl: "https://example.com/essay",
    readingMinutes: 12,
    analysis: {
      articleId: "article-1",
      analysisVersion: "blind-v1-context-v1",
      provider: "test",
      model: "test",
      intrinsicScore: 8,
      scores: { longTermValue: 8, ideaDensity: 8, argumentQuality: 8, originality: 8, clarityStructure: 8 },
      extractionConfidence: 0.95,
      analysisConfidence: 0.8,
      primaryTheme: "判断与决策",
      secondaryThemes: ["风险"],
      keywords: ["判断与决策", "风险", "长期主义"],
      evidence: [],
      riskNotes: [],
      contextSummary: "",
    },
    dynamicScore: 1,
    freshnessBonus: 0,
    explorationBonus: 0,
    authorPenalty: 0,
    themePenalty: 0,
    connectionBonus: 0,
    personalFit: 0,
    explanation: "",
    ...overrides,
  };
}

describe("fallback recommendation copy", () => {
  it("builds copy from the analysis without AI", () => {
    const copy = fallbackRecommendationCopy(candidate());
    expect(copy.whyWorthReading).toContain("判断与决策");
    expect(copy.whyToday).toContain("长期价值和思想密度");
    expect(copy.keywords[0]).toBe("判断与决策");
  });

  it("uses the exploration wording for unfamiliar themes", () => {
    const copy = fallbackRecommendationCopy(candidate({ explorationBonus: 0.5 }));
    expect(copy.whyToday).toContain("探索空间");
  });

  it.each([
    ["判断", "判断", "判断"],
    [" 判断 ", "判断", " "],
    ["", " ", "x".repeat(81)],
    ["阅读", "阅读", "阅读"],
  ])("keeps fallback copy valid after normalizing sparse keywords: %j", (...keywords) => {
    const base = candidate();
    base.analysis.keywords = keywords;
    const copy = fallbackRecommendationCopy(base);
    expect(() => assertPublicRecommendationCopy(copy)).not.toThrow();
    expect(copy.keywords.length).toBeGreaterThanOrEqual(3);
    expect(new Set(copy.keywords).size).toBe(copy.keywords.length);
    expect(copy.keywords.every((keyword) => keyword === keyword.trim())).toBe(true);
  });

  it("deduplicates keywords and caps at five", () => {
    const base = candidate();
    base.analysis.keywords = ["风险", "风险", "长期主义", "a", "b", "c", "d"];
    const copy = fallbackRecommendationCopy(base);
    expect(copy.keywords).toHaveLength(5);
    expect(copy.keywords.filter((value, index, values) => values.indexOf(value) === index)).toHaveLength(copy.keywords.length);
  });
});
