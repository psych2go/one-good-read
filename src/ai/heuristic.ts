import { weightedIntrinsicScore } from "../domain/scoring";
import type { ArticleAnalysis, ExtractedArticle, PublicRecommendationCopy, RankedCandidate } from "../domain/types";
import type { AiProvider, AnalysisContext } from "./provider";

const THEMES: Array<[string, RegExp]> = [
  ["风险与不确定性", /risk|uncertain|probab|fragil|volatil/i],
  ["工作与创造", /work|create|writing|maker|craft|career/i],
  ["创业与商业", /startup|founder|business|company|entrepreneur/i],
  ["投资与资本配置", /invest|capital|market|portfolio|return/i],
  ["科技与产业", /technology|software|internet|industry|platform/i],
  ["经济与制度", /econom|institution|policy|trade|regulat/i],
  ["决策与判断", /decision|judgment|choice|strategy|think/i],
  ["人生与长期主义", /life|long.term|compound|future|ambition/i],
];

export class HeuristicAiProvider implements AiProvider {
  readonly name = "heuristic";
  readonly model = "deterministic-v1";

  async analyze(article: ExtractedArticle, context: AnalysisContext): Promise<ArticleAnalysis> {
    const lengthFactor = Math.min(1, Math.log10(Math.max(article.wordCount, 100)) / 4);
    const paragraphs = article.text.split(/\n+/).filter(Boolean).length;
    const reasoningSignals = (article.text.match(/\b(?:because|therefore|however|although|for example|the reason|but)\b/gi) ?? []).length;
    const score = (base: number, extra = 0) => Math.min(9.2, Math.round((base + lengthFactor + extra) * 10) / 10);
    const scores = {
      longTermValue: score(6.8, /today|this week|breaking/i.test(article.title) ? -0.4 : 0.4),
      ideaDensity: score(6.9, Math.min(0.8, reasoningSignals / 50)),
      argumentQuality: score(6.7, Math.min(0.9, reasoningSignals / 40)),
      originality: score(6.8, /I believe|I think|my view|the paradox|the problem/i.test(article.text) ? 0.5 : 0.2),
      clarityStructure: score(7, Math.min(0.7, paragraphs / 100)),
    };
    const primaryTheme = THEMES.find(([, pattern]) => pattern.test(`${article.title} ${article.text.slice(0, 6000)}`))?.[0] ?? "学习与知识";
    const secondaryThemes = THEMES.filter(([theme, pattern]) => theme !== primaryTheme && pattern.test(article.text.slice(0, 10000))).slice(0, 3).map(([theme]) => theme);
    return {
      articleId: context.articleId,
      analysisVersion: context.analysisVersion,
      provider: this.name,
      model: this.model,
      scores,
      intrinsicScore: weightedIntrinsicScore(scores),
      extractionConfidence: article.extractionConfidence,
      analysisConfidence: 0.72,
      primaryTheme,
      secondaryThemes,
      keywords: [primaryTheme, ...secondaryThemes].slice(0, 5),
      evidence: [article.text.slice(0, 180).replace(/\n/g, " ")],
      riskNotes: ["本地启发式分析仅用于开发；生产环境应配置高质量全文分析模型。"],
      contextSummary: `${article.author} 的一篇关于${primaryTheme}的文章，约 ${article.readingMinutes} 分钟。`,
    };
  }

  async choose(candidates: RankedCandidate[]): Promise<{ articleId: string; rationale: string }> {
    const winner = candidates[0];
    if (!winner) throw new Error("No candidates to choose from");
    return { articleId: winner.articleId, rationale: "使用稳定动态总分选择第一名。" };
  }

  async writeRecommendation(winner: RankedCandidate): Promise<PublicRecommendationCopy> {
    return {
      whyWorthReading: `这篇文章围绕“${winner.analysis.primaryTheme}”提出一套可独立检验的思考框架。它的价值不在于给出速成答案，而在于帮助读者重新组织问题、判断证据，并把观点放进更长的时间尺度中。`,
      whyToday: winner.explorationBonus > 0.3
        ? `近期阅读记录中较少出现这一主题。今天选择它，是为了在不降低文章质量门槛的前提下，为陌生但可能重要的知识保留探索空间。`
        : `它在当前候选中同时具备较高的长期价值和思想密度，并避开了近期作者与主题的过度重复。`,
      keywords: [winner.analysis.primaryTheme, ...winner.analysis.keywords].filter((value, index, values) => values.indexOf(value) === index).slice(0, 5),
    };
  }
}
