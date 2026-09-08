import { createSelectionRun, saveAnalysis, upsertDiscovered } from "../../src/db/repository";
import type { ArticleAnalysis, RankedCandidate } from "../../src/domain/types";
import { shortEssay, standalone } from "../fixtures/content";

export const analysisVersion = "blind-v1-context-v1";
export const now = "2026-09-08T05:30:00+08:00";
export function testAnalysis(articleId: string): ArticleAnalysis {
  return { articleId, analysisVersion, provider: "test", model: "test", intrinsicScore: 8.25,
    scores: { longTermValue: 8, ideaDensity: 8, argumentQuality: 8, originality: 8, clarityStructure: 8 },
    extractionConfidence: .98, analysisConfidence: .9, primaryTheme: "决策与判断", secondaryThemes: [], keywords: ["判断", "决策", "不确定性"],
    evidence: [shortEssay], riskNotes: [], contextSummary: "An independent essay.", contentEligibility: standalone() };
}
export async function seedCandidate(db: D1Database, name: string, changes: Partial<ArticleAnalysis> = {}): Promise<RankedCandidate> {
  const articleId = await upsertDiscovered(db, { sourceId: "paul-graham", canonicalUrl: `https://paulgraham.com/${name}.html`, author: name, title: name }, now);
  await db.prepare("UPDATE articles SET access_state='free', word_count=70,reading_minutes=1 WHERE id=?").bind(articleId).run();
  const analysis = { ...testAnalysis(articleId), ...changes };
  await saveAnalysis(db, analysis, now);
  await db.prepare("INSERT INTO stored_objects (object_key,article_id,kind,size_bytes,expires_at) VALUES (?,?,'article_body',100,'2026-12-31')").bind(name, articleId).run();
  return { articleId, title: name, author: name, canonicalUrl: `https://paulgraham.com/${name}.html`, readingMinutes: 1, analysis,
    dynamicScore: 8.25, freshnessBonus: 0, explorationBonus: 0, authorPenalty: 0, themePenalty: 0, connectionBonus: 0, personalFit: 0, explanation: "test" };
}
export function seedRun(db: D1Database, date = "2026-09-08") { return createSelectionRun(db, date, "selection-test", analysisVersion); }
export function testEnv(db: D1Database): Env {
  return { DB: db, AUTOMATION_ENABLED: "true", BACKFILL_ENABLED: "true", SIMULATION_ENABLED: "false", RESERVOIR_TARGET: "1", SIMULATION_DAYS_REQUIRED: "7",
    ANALYSIS_VERSION: analysisVersion, EMBEDDING_VERSION: "embedding-v1", PREFERENCE_MODEL_VERSION: "ridge-v1", SELECTION_VERSION: "selection-test",
    ALERTS_ENABLED: "false", ALERT_TO_EMAIL: "", ALERT_FROM_EMAIL: "", R2_STORAGE_LIMIT_BYTES: "10000000000", APP_ORIGIN: "http://localhost:8787" } as unknown as Env;
}
