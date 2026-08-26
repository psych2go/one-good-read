import { describe, expect, it } from "vitest";
import { authorFatigue, freshnessBonus, passesQualityGate, stableRank } from "../src/domain/scoring";
import type { ArticleAnalysis, RankedCandidate } from "../src/domain/types";

const analysis: ArticleAnalysis = { articleId: "a", analysisVersion: "v1", provider: "test", model: "test", intrinsicScore: 8, scores: { longTermValue: 8, ideaDensity: 8, argumentQuality: 8, originality: 8, clarityStructure: 8 }, extractionConfidence: .98, analysisConfidence: .9, primaryTheme: "工作与创造", secondaryThemes: [], keywords: [], evidence: [], riskNotes: [], contextSummary: "" };

describe("quality gate", () => { it("accepts a balanced high quality article", () => expect(passesQualityGate(analysis)).toBe(true)); it("rejects low density despite a high total", () => expect(passesQualityGate({ ...analysis, scores: { ...analysis.scores, ideaDensity: 6.9 } })).toBe(false)); });
describe("freshness", () => { it("decays after thirty days", () => { const now = new Date("2026-08-26T06:00:00+08:00"); expect(freshnessBonus("2026-08-25T00:00:00Z", now)).toBe(.8); expect(freshnessBonus("2026-07-01T00:00:00Z", now)).toBe(0); }); });
describe("diversity", () => { it("forbids the same author on consecutive days", () => expect(authorFatigue("Paul Graham", [{ date: "2026-08-25", articleId: "x", author: "Paul Graham", primaryTheme: "工作与创造" }], new Date("2026-08-26T06:00:00+08:00"))).toBe(100)); });
describe("stable rank", () => { it("uses article id as the deterministic final tie break", () => { const base = { title: "", author: "", canonicalUrl: "", readingMinutes: 1, analysis, dynamicScore: 8, freshnessBonus: 0, explorationBonus: 0, authorPenalty: 0, themePenalty: 0, connectionBonus: 0, personalFit: 0, explanation: "" }; const values = [{ ...base, articleId: "b" }, { ...base, articleId: "a" }] as RankedCandidate[]; expect(stableRank(values).map((item) => item.articleId)).toEqual(["a","b"]); }); });

describe("Top candidate diversity", () => {
  it("caps repeated authors in the editorial slate", async () => {
    const { diverseTop } = await import("../src/domain/scoring");
    const base = { title: "", canonicalUrl: "", readingMinutes: 1, analysis, dynamicScore: 8, freshnessBonus: 0, explorationBonus: 0, authorPenalty: 0, themePenalty: 0, connectionBonus: 0, personalFit: 0, explanation: "" };
    const values = [
      { ...base, articleId: "a1", author: "A" },
      { ...base, articleId: "a2", author: "A" },
      { ...base, articleId: "a3", author: "A" },
      { ...base, articleId: "b1", author: "B", analysis: { ...analysis, primaryTheme: "风险与不确定性" } },
    ] as RankedCandidate[];
    expect(diverseTop(values, 4, 2).map((item) => item.articleId)).toEqual(["a1", "a2", "b1"]);
  });
});
