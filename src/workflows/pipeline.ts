import { aiProvider } from "../ai";
import { contentRejectionReason } from "../domain/content-gate";
import { passesQualityGate, rankCandidate, stableRank } from "../domain/scoring";
import type { DiscoveredArticle, RankedCandidate } from "../domain/types";
import { createSelectionRun, failSelectionRun, publishRecommendation, readyCandidates, recommendationHistory, rowToAnalysis, saveAnalysis, saveCandidateSnapshot, saveExtracted, upsertDiscovered, markRejected } from "../db/repository";
import { sourceAdapter, sourceAdapters } from "../sources";

export interface IngestSummary { sourceId: string; discovered: number; analyzed: number; rejected: number; skipped: number; errors: string[]; }

export async function ingestSource(env: Env, sourceId: string, processLimit: number): Promise<IngestSummary> {
  const adapter = sourceAdapter(sourceId);
  const articles = await adapter.discover();
  const summary: IngestSummary = { sourceId, discovered: articles.length, analyzed: 0, rejected: 0, skipped: 0, errors: [] };
  const now = new Date().toISOString();
  let processed = 0;
  for (const article of articles) {
    const id = await upsertDiscovered(env.DB, article, now);
    const state = await env.DB.prepare("SELECT status,rejection_reason FROM articles WHERE id=?").bind(id).first<{ status: string; rejection_reason: string | null }>();
    const retryableRejection = state?.status === "rejected" && state.rejection_reason === "empty_body";
    if (state?.status && !["discovered", "analysis_failed", "unavailable"].includes(state.status) && !retryableRejection) { summary.skipped += 1; continue; }
    if (processed >= processLimit) { summary.skipped += 1; continue; }
    processed += 1;
    try {
      await processArticle(env, id, article);
      summary.analyzed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.errors.push(`${article.canonicalUrl}: ${message}`);
      await env.DB.prepare("UPDATE articles SET status='analysis_failed', retry_count=retry_count+1, rejection_reason=?, updated_at=? WHERE id=?")
        .bind(message.slice(0, 500), new Date().toISOString(), id).run();
    }
  }
  await env.DB.prepare("UPDATE sources SET last_scanned_at=?, consecutive_failures=?, updated_at=? WHERE id=?")
    .bind(now, summary.errors.length ? 1 : 0, now, sourceId).run();
  return summary;
}

async function processArticle(env: Env, articleId: string, discovered: DiscoveredArticle): Promise<void> {
  const adapter = sourceAdapter(discovered.sourceId);
  const extracted = await adapter.extract(discovered);
  const rejection = contentRejectionReason(extracted);
  const now = new Date().toISOString();
  if (rejection) {
    await markRejected(env.DB, articleId, rejection, now);
    return;
  }
  await saveExtracted(env, articleId, extracted, now);
  const provider = aiProvider(env);
  const analysis = await provider.analyze(extracted, { articleId, analysisVersion: String(env.ANALYSIS_VERSION) });
  if (!passesQualityGate(analysis)) {
    await saveAnalysis(env.DB, analysis, now);
    await markRejected(env.DB, articleId, "below_quality_gate", now);
    return;
  }
  await saveAnalysis(env.DB, analysis, now);
}

export async function runDailySelection(env: Env, date: string, publishAt?: string): Promise<{ winnerArticleId: string; runId: string }> {
  const existing = await env.DB.prepare("SELECT article_id FROM recommendations WHERE recommendation_date=? AND status='published'").bind(date).first<{ article_id: string }>();
  if (existing) return { winnerArticleId: existing.article_id, runId: "existing" };

  const runId = await createSelectionRun(env.DB, date, String(env.SELECTION_VERSION), String(env.ANALYSIS_VERSION));
  try {
    const [rows, history] = await Promise.all([readyCandidates(env.DB, String(env.ANALYSIS_VERSION)), recommendationHistory(env.DB)]);
    const now = new Date(`${date}T06:00:00+08:00`);
    const ranked = stableRank(rows.map((row) => rankCandidate({
      articleId: row.id,
      title: row.title,
      author: row.author,
      canonicalUrl: row.canonical_url,
      publishedAt: row.published_at ?? undefined,
      readingMinutes: row.reading_minutes,
      analysis: rowToAnalysis(row),
      history,
      now,
    })).filter((candidate) => candidate.authorPenalty < 100)).slice(0, 10);
    if (!ranked.length) throw new Error("No eligible candidates passed the quality and diversity gates");
    await saveCandidateSnapshot(env.DB, runId, ranked);

    const verified = await firstReachable(ranked);
    if (!verified.length) throw new Error("All Top candidates failed the publication link check");
    const provider = aiProvider(env);
    const recentSummary = history.slice(0, 7).map((item) => `${item.date} ${item.author} / ${item.primaryTheme}`).join("\n") || "暂无历史推荐";
    const initialWinner = verified[0];
    if (!initialWinner) throw new Error("No reachable candidate remained");
    let winner = initialWinner;
    try {
      const decision = await provider.choose(verified, recentSummary);
      winner = verified.find((candidate) => candidate.articleId === decision.articleId) ?? winner;
    } catch (error) {
      console.error(JSON.stringify({ event: "editor_choice_fallback", message: error instanceof Error ? error.message : String(error) }));
    }
    const copy = await provider.writeRecommendation(winner, recentSummary);
    await publishRecommendation({ db: env.DB, date, runId, winner, whyWorthReading: copy.whyWorthReading, whyToday: copy.whyToday, keywords: copy.keywords, now: new Date().toISOString(), publishAt });
    return { winnerArticleId: winner.articleId, runId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failSelectionRun(env.DB, runId, message, new Date().toISOString());
    throw error;
  }
}

async function firstReachable(candidates: RankedCandidate[]): Promise<RankedCandidate[]> {
  const reachable: RankedCandidate[] = [];
  for (const candidate of candidates.slice(0, 6)) {
    try {
      const response = await fetch(candidate.canonicalUrl, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(12_000), headers: { "User-Agent": "OneGoodRead/0.1 (+https://github.com/one-good-read)" } });
      const challengedAllowlistedPage = response.status === 403 && response.headers.get("cf-mitigated") === "challenge" && new URL(candidate.canonicalUrl).hostname === "marginalrevolution.com";
      if (response.ok || response.status === 405 || challengedAllowlistedPage) reachable.push(candidate);
    } catch {
      // The next precomputed candidate is the fallback.
    }
  }
  return reachable;
}

export function adapterIds(): string[] {
  return sourceAdapters().map((adapter) => adapter.sourceId);
}
