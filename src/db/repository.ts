import type { ArticleAnalysis, DiscoveredArticle, ExtractedArticle, FeedbackKind, RankedCandidate, RecommendationHistoryItem } from "../domain/types";

export interface ReadyArticleRow {
  id: string;
  source_id: string;
  canonical_url: string;
  title: string;
  author: string;
  published_at: string | null;
  reading_minutes: number;
  word_count: number;
  projection: string | null;
  analysis_version: string;
  provider: string;
  model: string;
  intrinsic_score: number;
  long_term_value: number;
  idea_density: number;
  argument_quality: number;
  originality: number;
  clarity_structure: number;
  extraction_confidence: number;
  analysis_confidence: number;
  primary_theme: string;
  secondary_themes: string;
  keywords: string;
  evidence: string;
  risk_notes: string;
  context_summary: string;
}

export async function upsertDiscovered(db: D1Database, article: DiscoveredArticle, now: string): Promise<string> {
  const id = await stableArticleId(article.canonicalUrl);
  await db.prepare(`
    INSERT INTO articles (id, source_id, canonical_url, title, author, published_at, discovered_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_url) DO UPDATE SET
      title = excluded.title,
      author = excluded.author,
      published_at = COALESCE(excluded.published_at, articles.published_at),
      updated_at = excluded.updated_at
  `).bind(id, article.sourceId, article.canonicalUrl, article.title, article.author, article.publishedAt ?? null, now, now).run();
  return id;
}

export async function markRejected(db: D1Database, articleId: string, reason: string, now: string): Promise<void> {
  await db.prepare("UPDATE articles SET status='rejected', rejection_reason=?, last_checked_at=?, updated_at=? WHERE id=?")
    .bind(reason, now, now, articleId).run();
}

export async function saveExtracted(env: Env, articleId: string, article: ExtractedArticle, now: string): Promise<string> {
  const key = `articles/${articleId}/${article.contentHash}.txt`;
  await env.CONTENT.put(key, article.text, {
    httpMetadata: { contentType: "text/plain; charset=utf-8" },
    customMetadata: { source: article.sourceId, canonicalUrl: article.canonicalUrl },
  });
  await env.DB.prepare(`
    UPDATE articles SET title=?, author=?, published_at=?, access_state='free', rejection_reason=NULL, content_hash=?, body_key=?, word_count=?, reading_minutes=?, last_checked_at=?, updated_at=? WHERE id=?
  `).bind(article.title, article.author, article.publishedAt ?? null, article.contentHash, key, article.wordCount, article.readingMinutes, now, now, articleId).run();
  return key;
}

export async function saveAnalysis(db: D1Database, analysis: ArticleAnalysis, now: string): Promise<void> {
  await db.prepare(`
    INSERT INTO analyses (
      id, article_id, analysis_version, provider, model, intrinsic_score,
      long_term_value, idea_density, argument_quality, originality, clarity_structure,
      extraction_confidence, analysis_confidence, primary_theme, secondary_themes,
      keywords, evidence, risk_notes, context_summary, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(article_id, analysis_version) DO NOTHING
  `).bind(
    crypto.randomUUID(), analysis.articleId, analysis.analysisVersion, analysis.provider, analysis.model, analysis.intrinsicScore,
    analysis.scores.longTermValue, analysis.scores.ideaDensity, analysis.scores.argumentQuality, analysis.scores.originality,
    analysis.scores.clarityStructure, analysis.extractionConfidence, analysis.analysisConfidence, analysis.primaryTheme,
    JSON.stringify(analysis.secondaryThemes), JSON.stringify(analysis.keywords), JSON.stringify(analysis.evidence),
    JSON.stringify(analysis.riskNotes), analysis.contextSummary, now,
  ).run();
  await db.prepare("UPDATE articles SET status='ready', updated_at=? WHERE id=?").bind(now, analysis.articleId).run();
}

export async function readyCandidates(db: D1Database, analysisVersion: string, embeddingVersion: string, limit = 250): Promise<ReadyArticleRow[]> {
  const result = await db.prepare(`
    SELECT a.id, a.source_id, a.canonical_url, a.title, a.author, a.published_at, a.reading_minutes, a.word_count, e.projection,
      n.analysis_version, n.provider, n.model, n.intrinsic_score, n.long_term_value, n.idea_density,
      n.argument_quality, n.originality, n.clarity_structure, n.extraction_confidence,
      n.analysis_confidence, n.primary_theme, n.secondary_themes, n.keywords, n.evidence,
      n.risk_notes, n.context_summary
    FROM articles a
    JOIN analyses n ON n.article_id = a.id AND n.analysis_version = ?
    LEFT JOIN embeddings e ON e.article_id=a.id AND e.embedding_version=?
    WHERE a.status='ready' AND a.access_state='free'
      AND NOT EXISTS (SELECT 1 FROM recommendations r WHERE r.article_id=a.id AND r.status='published')
    ORDER BY n.intrinsic_score DESC, a.id ASC
    LIMIT ?
  `).bind(analysisVersion, embeddingVersion, limit).all<ReadyArticleRow>();
  return result.results;
}

export function rowToAnalysis(row: ReadyArticleRow): ArticleAnalysis {
  return {
    articleId: row.id,
    analysisVersion: row.analysis_version,
    provider: row.provider,
    model: row.model,
    intrinsicScore: row.intrinsic_score,
    scores: {
      longTermValue: row.long_term_value,
      ideaDensity: row.idea_density,
      argumentQuality: row.argument_quality,
      originality: row.originality,
      clarityStructure: row.clarity_structure,
    },
    extractionConfidence: row.extraction_confidence,
    analysisConfidence: row.analysis_confidence,
    primaryTheme: row.primary_theme,
    secondaryThemes: JSON.parse(row.secondary_themes) as string[],
    keywords: JSON.parse(row.keywords) as string[],
    evidence: JSON.parse(row.evidence) as string[],
    riskNotes: JSON.parse(row.risk_notes) as string[],
    contextSummary: row.context_summary,
  };
}

export async function recommendationHistory(db: D1Database, limit = 60): Promise<RecommendationHistoryItem[]> {
  const result = await db.prepare(`
    SELECT r.recommendation_date AS date, a.id AS articleId, a.author, n.primary_theme AS primaryTheme
    FROM recommendations r
    JOIN articles a ON a.id=r.article_id
    JOIN analyses n ON n.id=(SELECT n2.id FROM analyses n2 WHERE n2.article_id=a.id ORDER BY n2.created_at DESC LIMIT 1)
    WHERE r.status='published' AND datetime(r.published_at) <= datetime('now')
    ORDER BY r.recommendation_date DESC
    LIMIT ?
  `).bind(limit).all<{ date: string; articleId: string; author: string; primaryTheme: string }>();
  return result.results;
}

export async function createSelectionRun(db: D1Database, date: string, selectionVersion: string, analysisVersion: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO selection_runs (id, recommendation_date, selection_version, analysis_version, status) VALUES (?, ?, ?, ?, 'running')")
    .bind(id, date, selectionVersion, analysisVersion).run();
  return id;
}

export async function saveCandidateSnapshot(db: D1Database, runId: string, candidates: RankedCandidate[]): Promise<void> {
  const statements = candidates.map((candidate, index) => db.prepare(`
    INSERT INTO selection_candidates (
      selection_run_id, article_id, rank, intrinsic_score, dynamic_score, freshness_bonus,
      exploration_bonus, author_penalty, theme_penalty, connection_bonus, personal_fit, explanation
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(runId, candidate.articleId, index + 1, candidate.analysis.intrinsicScore, candidate.dynamicScore,
    candidate.freshnessBonus, candidate.explorationBonus, candidate.authorPenalty, candidate.themePenalty,
    candidate.connectionBonus, candidate.personalFit, candidate.explanation));
  if (statements.length) await db.batch(statements);
}

export async function publishRecommendation(input: {
  db: D1Database;
  date: string;
  runId: string;
  winner: RankedCandidate;
  whyWorthReading: string;
  whyToday: string;
  keywords: string[];
  now: string;
  publishAt?: string;
}): Promise<void> {
  const recommendationId = crypto.randomUUID();
  await input.db.batch([
    input.db.prepare(`
      INSERT INTO recommendations (id, recommendation_date, article_id, selection_run_id, why_worth_reading, why_today, public_keywords, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(recommendation_date) DO NOTHING
    `).bind(recommendationId, input.date, input.winner.articleId, input.runId, input.whyWorthReading, input.whyToday, JSON.stringify(input.keywords), input.publishAt ?? input.now),
    input.db.prepare("UPDATE articles SET status='recommended', updated_at=? WHERE id=?").bind(input.now, input.winner.articleId),
    input.db.prepare("UPDATE selection_runs SET status='complete', winner_article_id=?, completed_at=? WHERE id=?").bind(input.winner.articleId, input.now, input.runId),
  ]);
}

export async function failSelectionRun(db: D1Database, runId: string, reason: string, now: string): Promise<void> {
  await db.prepare("UPDATE selection_runs SET status='failed', failure_reason=?, completed_at=? WHERE id=?").bind(reason, now, runId).run();
}

export async function addFeedback(db: D1Database, recommendationId: string, kind: FeedbackKind): Promise<void> {
  await db.prepare("INSERT INTO feedback (id, recommendation_id, kind) VALUES (?, ?, ?)").bind(crypto.randomUUID(), recommendationId, kind).run();
}

export async function stableArticleId(url: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
  return [...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function annotateSelectionRun(db: D1Database, runId: string, embeddingVersion: string, preferenceModelId?: string): Promise<void> {
  await db.prepare("UPDATE selection_runs SET embedding_version=?,preference_model_id=? WHERE id=?").bind(embeddingVersion, preferenceModelId ?? null, runId).run();
}
