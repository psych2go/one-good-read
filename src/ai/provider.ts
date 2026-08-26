import type { ArticleAnalysis, ExtractedArticle, PublicRecommendationCopy, RankedCandidate } from "../domain/types";

export interface AnalysisContext {
  articleId: string;
  analysisVersion: string;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  analyze(article: ExtractedArticle, context: AnalysisContext): Promise<ArticleAnalysis>;
  choose(candidates: RankedCandidate[], recentSummary: string): Promise<{ articleId: string; rationale: string }>;
  writeRecommendation(winner: RankedCandidate, recentSummary: string): Promise<PublicRecommendationCopy>;
}
