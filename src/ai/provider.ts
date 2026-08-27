import type { ArticleAnalysis, ExtractedArticle, PublicRecommendationCopy, RankedCandidate } from "../domain/types";

export interface AnalysisContext {
  articleId: string;
  analysisVersion: string;
}

export interface AiProbeResult { provider: string; model: string; structuredOutput: boolean; message: string; }

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  probe(): Promise<AiProbeResult>;
  analyze(article: ExtractedArticle, context: AnalysisContext): Promise<ArticleAnalysis>;
  choose(candidates: RankedCandidate[], recentSummary: string): Promise<{ articleId: string; rationale: string }>;
  writeRecommendation(winner: RankedCandidate, recentSummary: string): Promise<PublicRecommendationCopy>;
}
