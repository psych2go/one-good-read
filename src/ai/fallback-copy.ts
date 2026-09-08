import type { PublicRecommendationCopy, RankedCandidate } from "../domain/types";

/**
 * Deterministic public copy used when the AI copywriter is unavailable.
 * Normalizes and pads keywords so valid-but-repeated analysis keywords do not
 * make the outage fallback fail public-copy validation.
 */
export function fallbackRecommendationCopy(winner: RankedCandidate): PublicRecommendationCopy {
  const keywords = [...new Set([winner.analysis.primaryTheme, ...winner.analysis.keywords]
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value.length <= 80))].slice(0, 5);
  // Neutral labels describe the reading activity, not unverified article claims.
  for (const label of ["阅读", "思考", "观点"]) {
    if (keywords.length >= 3) break;
    if (!keywords.includes(label)) keywords.push(label);
  }
  return {
    whyWorthReading: `这篇文章围绕“${winner.analysis.primaryTheme}”提出一套可独立检验的思考框架。它的价值不在于给出速成答案，而在于帮助读者重新组织问题、判断证据，并把观点放进更长的时间尺度中。`,
    whyToday: winner.explorationBonus > 0.3
      ? "近期阅读记录中较少出现这一主题。今天选择它，是为了在不降低文章质量门槛的前提下，为陌生但可能重要的知识保留探索空间。"
      : "它在当前候选中同时具备较高的长期价值和思想密度，并避开了近期作者与主题的过度重复。",
    keywords,
  };
}
