export type SourceId = "paul-graham" | "marginal-revolution" | "howard-marks";

export interface DiscoveredArticle {
  sourceId: SourceId;
  canonicalUrl: string;
  title: string;
  author: string;
  publishedAt?: string;
  inlineHtml?: string;
}

export interface ExtractedArticle extends DiscoveredArticle {
  text: string;
  contentHash: string;
  wordCount: number;
  readingMinutes: number;
  extractionConfidence: number;
  externalLinkCount: number;
}

export interface IntrinsicScores {
  longTermValue: number;
  ideaDensity: number;
  argumentQuality: number;
  originality: number;
  clarityStructure: number;
}

export interface ArticleAnalysis {
  articleId: string;
  analysisVersion: string;
  provider: string;
  model: string;
  scores: IntrinsicScores;
  intrinsicScore: number;
  extractionConfidence: number;
  analysisConfidence: number;
  primaryTheme: string;
  secondaryThemes: string[];
  keywords: string[];
  evidence: string[];
  riskNotes: string[];
  contextSummary: string;
}

export interface RankedCandidate {
  articleId: string;
  title: string;
  author: string;
  canonicalUrl: string;
  publishedAt?: string;
  readingMinutes: number;
  analysis: ArticleAnalysis;
  dynamicScore: number;
  freshnessBonus: number;
  explorationBonus: number;
  authorPenalty: number;
  themePenalty: number;
  connectionBonus: number;
  personalFit: number;
  explanation: string;
}

export interface PublicRecommendationCopy {
  whyWorthReading: string;
  whyToday: string;
  keywords: string[];
}

export interface RecommendationHistoryItem {
  date: string;
  articleId: string;
  author: string;
  primaryTheme: string;
}

export type FeedbackKind = "valuable" | "good" | "not_for_me" | "unfinished" | "later";
