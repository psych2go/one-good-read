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
    expect(copy.keywords[0]).toBe("判断与决策");
    expect(() => assertPublicRecommendationCopy(copy)).not.toThrow();
  });

  it("uses the exploration wording for unfamiliar themes", () => {
    const copy = fallbackRecommendationCopy(candidate({ explorationBonus: 0.5 }));
    expect(copy.whyToday).toMatch(/探索|切换/);
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

  it("uses the article's own evidence and skips internal notes and control tokens", () => {
    const base = candidate();
    base.analysis.evidence = ["文章提出“有用写作”的明确标准：正确、重要、新颖、尽可能有力地表达。<|DELIM_x|>其余部分。"];
    base.analysis.contextSummary = "盲评认为结构清晰。";
    base.analysis.keywords = ["有用写作", "资本成本（WACC）? no invalid? Wait", "正确性"];
    const copy = fallbackRecommendationCopy(base, "2026-10-30");
    expect(copy.whyWorthReading).toContain("有用写作");
    expect(copy.whyWorthReading).not.toContain("盲评");
    expect(copy.whyWorthReading).not.toContain("DELIM");
    expect(copy.keywords.some((keyword) => keyword.includes("Wait"))).toBe(false);
    expect(() => assertPublicRecommendationCopy(copy)).not.toThrow();
  });

  it("is deterministic per date and article but rotates phrasing across days", () => {
    const base = candidate();
    base.analysis.evidence = ["文章把期限错配、存款集中和数字化挤兑连成一条完整的风险传导链。"];
    expect(fallbackRecommendationCopy(base, "2026-10-30")).toEqual(fallbackRecommendationCopy(base, "2026-10-30"));
    const days = Array.from({ length: 10 }, (_, index) => `2026-10-${String(index + 10).padStart(2, "0")}`);
    const copies = days.map((date) => fallbackRecommendationCopy(base, date));
    expect(new Set(copies.map((copy) => copy.whyWorthReading)).size).toBeGreaterThan(2);
    expect(new Set(copies.map((copy) => copy.whyToday)).size).toBeGreaterThan(2);
    for (const copy of copies) expect(() => assertPublicRecommendationCopy(copy)).not.toThrow();
  });

  it("stays within public length limits for very long analysis fields", () => {
    const base = candidate({ readingMinutes: 45, freshnessBonus: 0.8 });
    base.analysis.evidence = ["文章" + "非常长的论证细节，".repeat(80) + "结束。"];
    base.analysis.secondaryThemes = ["一个很长的次要主题名称".repeat(3), "另一个次要主题"];
    for (const date of ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05"]) {
      expect(() => assertPublicRecommendationCopy(fallbackRecommendationCopy(base, date))).not.toThrow();
    }
  });

  it("deduplicates keywords and caps at five", () => {
    const base = candidate();
    base.analysis.keywords = ["风险", "风险", "长期主义", "a", "b", "c", "d"];
    const copy = fallbackRecommendationCopy(base);
    expect(copy.keywords).toHaveLength(5);
    expect(copy.keywords.filter((value, index, values) => values.indexOf(value) === index)).toHaveLength(copy.keywords.length);
  });
});
