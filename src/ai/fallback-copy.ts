import type { PublicRecommendationCopy, RankedCandidate } from "../domain/types";

/**
 * Deterministic public copy used when the AI copywriter is unavailable.
 * Mirrors the heuristic provider's template so a relay outage or quota
 * exhaustion can never block the daily publication path.
 */
export function fallbackRecommendationCopy(winner: RankedCandidate): PublicRecommendationCopy {
  return {
    whyWorthReading: `这篇文章围绕“${winner.analysis.primaryTheme}”提出一套可独立检验的思考框架。它的价值不在于给出速成答案，而在于帮助读者重新组织问题、判断证据，并把观点放进更长的时间尺度中。`,
    whyToday: winner.explorationBonus > 0.3
      ? "近期阅读记录中较少出现这一主题。今天选择它，是为了在不降低文章质量门槛的前提下，为陌生但可能重要的知识保留探索空间。"
      : "它在当前候选中同时具备较高的长期价值和思想密度，并避开了近期作者与主题的过度重复。",
    keywords: [winner.analysis.primaryTheme, ...winner.analysis.keywords].filter((value, index, values) => values.indexOf(value) === index).slice(0, 5),
  };
}
