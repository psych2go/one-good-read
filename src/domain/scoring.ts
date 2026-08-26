import type { ArticleAnalysis, RankedCandidate, RecommendationHistoryItem } from "./types";

export const QUALITY_GATE = {
  intrinsic: 7.5,
  longTerm: 7,
  density: 7,
  minimumDimension: 5,
  extractionConfidence: 0.9,
  analysisConfidence: 0.7,
} as const;

export function weightedIntrinsicScore(scores: ArticleAnalysis["scores"]): number {
  return round(
    scores.longTermValue * 0.3 +
      scores.ideaDensity * 0.25 +
      scores.argumentQuality * 0.2 +
      scores.originality * 0.15 +
      scores.clarityStructure * 0.1,
  );
}

export function passesQualityGate(analysis: ArticleAnalysis): boolean {
  const dimensions = Object.values(analysis.scores);
  return (
    analysis.intrinsicScore >= QUALITY_GATE.intrinsic &&
    analysis.scores.longTermValue >= QUALITY_GATE.longTerm &&
    analysis.scores.ideaDensity >= QUALITY_GATE.density &&
    dimensions.every((score) => score >= QUALITY_GATE.minimumDimension) &&
    analysis.extractionConfidence >= QUALITY_GATE.extractionConfidence &&
    analysis.analysisConfidence >= QUALITY_GATE.analysisConfidence
  );
}

export function freshnessBonus(publishedAt: string | undefined, now: Date): number {
  if (!publishedAt) return 0;
  const ageDays = Math.max(0, (now.getTime() - new Date(publishedAt).getTime()) / 86_400_000);
  if (ageDays <= 3) return 0.8;
  if (ageDays <= 7) return 0.64;
  if (ageDays <= 14) return 0.4;
  if (ageDays <= 30) return 0.16;
  return 0;
}

export function authorFatigue(author: string, history: RecommendationHistoryItem[], date: Date): number {
  let penalty = 0;
  for (const item of history) {
    if (item.author !== author) continue;
    const age = (date.getTime() - new Date(`${item.date}T00:00:00+08:00`).getTime()) / 86_400_000;
    if (age < 2) return 100;
    if (age <= 3) penalty += 1.25;
    else if (age <= 7) penalty += 0.65;
    else if (age <= 14) penalty += 0.2;
  }
  return round(penalty);
}

export function themeFatigue(theme: string, history: RecommendationHistoryItem[], date: Date): number {
  const recent = history.filter((item) => {
    const age = (date.getTime() - new Date(`${item.date}T00:00:00+08:00`).getTime()) / 86_400_000;
    return item.primaryTheme === theme && age <= 7;
  }).length;
  return round(recent === 0 ? 0 : 0.35 + Math.max(0, recent - 1) * 0.35);
}

export function explorationBonus(theme: string, history: RecommendationHistoryItem[]): number {
  const appearances = history.filter((item) => item.primaryTheme === theme).length;
  if (appearances === 0) return 0.45;
  if (appearances === 1) return 0.2;
  return 0;
}

export function rankCandidate(input: {
  articleId: string;
  title: string;
  author: string;
  canonicalUrl: string;
  publishedAt?: string;
  readingMinutes: number;
  analysis: ArticleAnalysis;
  history: RecommendationHistoryItem[];
  now: Date;
  personalFit?: number;
  connectionBonus?: number;
}): RankedCandidate {
  const fresh = freshnessBonus(input.publishedAt, input.now);
  const authorPenalty = authorFatigue(input.author, input.history, input.now);
  const themePenalty = themeFatigue(input.analysis.primaryTheme, input.history, input.now);
  const explore = explorationBonus(input.analysis.primaryTheme, input.history);
  const personal = clamp(input.personalFit ?? 0, -0.9, 0.9);
  const connection = clamp(input.connectionBonus ?? 0, 0, 0.5);
  const dynamicScore = round(input.analysis.intrinsicScore + fresh + explore + personal + connection - authorPenalty - themePenalty);
  return {
    ...input,
    dynamicScore,
    freshnessBonus: fresh,
    explorationBonus: explore,
    authorPenalty,
    themePenalty,
    connectionBonus: connection,
    personalFit: personal,
    explanation: `质量 ${input.analysis.intrinsicScore.toFixed(2)}；新鲜度 +${fresh.toFixed(2)}；探索 +${explore.toFixed(2)}；作者疲劳 -${authorPenalty.toFixed(2)}；主题疲劳 -${themePenalty.toFixed(2)}`,
  };
}

export function stableRank(candidates: RankedCandidate[]): RankedCandidate[] {
  return [...candidates].sort((a, b) => b.dynamicScore - a.dynamicScore || b.analysis.intrinsicScore - a.analysis.intrinsicScore || a.articleId.localeCompare(b.articleId));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
