import { analysisContentRejectionReason, parseContentEligibility } from "../domain/content-gate";
import { passesQualityGate, weightedIntrinsicScore } from "../domain/scoring";
import { THEMES } from "../ai/openai";
import type { ArticleAnalysis, ContentEligibility, IntrinsicScores } from "../domain/types";
import { createAndStoreEmbedding } from "../embeddings/service";
import { saveAnalysis } from "../db/repository";

export type ExternalAnalysisResult = {
  articleId: string;
  status: "ready" | "rejected";
  reason?: string;
  intrinsicScore: number;
  embedding?: { created: boolean; indexed?: boolean; error?: string };
};

/** Accept a precomputed analysis (e.g. from Grok Bot) for an already-ingested article. */
export async function applyExternalAnalysis(env: Env, raw: unknown): Promise<{ ok: true; result: ExternalAnalysisResult } | { ok: false; error: string; status: 400 | 404 | 409 | 422 }> {
  const parsed = parseExternalAnalysisPayload(raw, String(env.ANALYSIS_VERSION));
  if (!parsed.ok) return parsed;

  const article = await env.DB.prepare(
    "SELECT id, title, author, status, body_key, word_count FROM articles WHERE id=?",
  ).bind(parsed.articleId).first<{ id: string; title: string; author: string; status: string; body_key: string | null; word_count: number | null }>();
  if (!article) return { ok: false, error: "article_not_found", status: 404 };
  if (["recommended", "blocked", "unavailable"].includes(article.status)) {
    return { ok: false, error: `article_status_locked:${article.status}`, status: 409 };
  }
  if (!article.body_key) return { ok: false, error: "article_body_missing", status: 422 };

  const object = await env.CONTENT.get(article.body_key);
  if (!object) return { ok: false, error: "article_body_unavailable", status: 422 };
  const body = await object.text();

  const eligibility = parseContentEligibility(parsed.eligibility, body);
  if (!eligibility) return { ok: false, error: "invalid_content_eligibility", status: 422 };

  const scores = parsed.scores;
  const analysis: ArticleAnalysis = {
    contentEligibility: eligibility,
    articleId: parsed.articleId,
    analysisVersion: String(env.ANALYSIS_VERSION),
    provider: parsed.provider,
    model: parsed.model,
    scores,
    intrinsicScore: weightedIntrinsicScore(scores),
    extractionConfidence: parsed.extractionConfidence,
    analysisConfidence: parsed.analysisConfidence,
    primaryTheme: parsed.primaryTheme,
    secondaryThemes: parsed.secondaryThemes,
    keywords: parsed.keywords,
    evidence: parsed.evidence,
    riskNotes: parsed.riskNotes,
    contextSummary: parsed.contextSummary,
  };

  const now = new Date().toISOString();
  const eligibilityRejection = analysisContentRejectionReason(analysis);
  const belowGate = !passesQualityGate(analysis);
  if (eligibilityRejection || belowGate) {
    await saveAnalysis(env.DB, { ...analysis, contentEligibility: eligibility }, now);
    const reason = eligibilityRejection ?? "below_quality_gate";
    await env.DB.prepare(
      "UPDATE articles SET status='rejected', rejection_reason=?, content_review_reason=?, updated_at=? WHERE id=? AND status NOT IN ('recommended','blocked','unavailable')",
    ).bind(reason, eligibilityRejection ?? null, now, parsed.articleId).run();
    return {
      ok: true,
      result: { articleId: parsed.articleId, status: "rejected", reason, intrinsicScore: analysis.intrinsicScore },
    };
  }

  await saveAnalysis(env.DB, analysis, now);
  await env.DB.prepare(
    "UPDATE stored_objects SET expires_at=NULL WHERE article_id=? AND kind='article_body' AND deleted_at IS NULL",
  ).bind(parsed.articleId).run();

  let embedding: ExternalAnalysisResult["embedding"] = { created: false };
  try {
    const stored = await createAndStoreEmbedding(env, {
      articleId: parsed.articleId,
      title: article.title,
      author: article.author,
      primaryTheme: analysis.primaryTheme,
      text: body,
    });
    embedding = { created: true, indexed: stored.indexed };
  } catch (error) {
    embedding = { created: false, error: error instanceof Error ? error.message : String(error) };
  }

  const after = await env.DB.prepare("SELECT status, rejection_reason FROM articles WHERE id=?")
    .bind(parsed.articleId).first<{ status: string; rejection_reason: string | null }>();
  return {
    ok: true,
    result: {
      articleId: parsed.articleId,
      status: after?.status === "ready" ? "ready" : "rejected",
      reason: after?.rejection_reason ?? undefined,
      intrinsicScore: analysis.intrinsicScore,
      embedding,
    },
  };
}

function parseExternalAnalysisPayload(raw: unknown, analysisVersion: string):
  | { ok: true; articleId: string; provider: string; model: string; scores: IntrinsicScores; extractionConfidence: number; analysisConfidence: number; primaryTheme: string; secondaryThemes: string[]; keywords: string[]; evidence: string[]; riskNotes: string[]; contextSummary: string; eligibility: ContentEligibility }
  | { ok: false; error: string; status: 400 | 404 | 409 | 422 } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "invalid_json", status: 400 };
  const item = raw as Record<string, unknown>;
  const articleId = typeof item.articleId === "string" ? item.articleId.trim() : "";
  if (!/^[a-f0-9]{32}$/i.test(articleId)) return { ok: false, error: "invalid_article_id", status: 400 };

  const provider = typeof item.provider === "string" && item.provider.trim() ? item.provider.trim().slice(0, 64) : "grok-bot";
  const model = typeof item.model === "string" && item.model.trim() ? item.model.trim().slice(0, 128) : "grok-bot";
  if (typeof item.analysisVersion === "string" && item.analysisVersion !== analysisVersion) {
    return { ok: false, error: `analysis_version_mismatch:expected_${analysisVersion}`, status: 422 };
  }

  const scoresRaw = item.scores;
  if (!scoresRaw || typeof scoresRaw !== "object") return { ok: false, error: "invalid_scores", status: 400 };
  const scoreBag = scoresRaw as Record<string, unknown>;
  const longTermValue = numberField(scoreBag.longTermValue);
  const ideaDensity = numberField(scoreBag.ideaDensity);
  const argumentQuality = numberField(scoreBag.argumentQuality);
  const originality = numberField(scoreBag.originality);
  const clarityStructure = numberField(scoreBag.clarityStructure);
  if ([longTermValue, ideaDensity, argumentQuality, originality, clarityStructure].some((value) => value === undefined)) {
    return { ok: false, error: "invalid_scores", status: 400 };
  }
  const typedScores: IntrinsicScores = {
    longTermValue: longTermValue!,
    ideaDensity: ideaDensity!,
    argumentQuality: argumentQuality!,
    originality: originality!,
    clarityStructure: clarityStructure!,
  };
  if (Object.values(typedScores).some((value) => value < 0 || value > 10)) return { ok: false, error: "scores_out_of_range", status: 400 };

  const primaryTheme = typeof item.primaryTheme === "string" ? item.primaryTheme : "";
  if (!THEMES.includes(primaryTheme)) return { ok: false, error: "invalid_primary_theme", status: 400 };
  const secondaryThemes = stringArray(item.secondaryThemes, 0, 3);
  if (!secondaryThemes || secondaryThemes.some((theme) => !THEMES.includes(theme))) return { ok: false, error: "invalid_secondary_themes", status: 400 };
  const keywords = stringArray(item.keywords, 3, 5);
  if (!keywords) return { ok: false, error: "invalid_keywords", status: 400 };
  const evidence = stringArray(item.evidence, 1, 5);
  if (!evidence) return { ok: false, error: "invalid_evidence", status: 400 };
  const riskNotes = stringArray(item.riskNotes ?? [], 0, 5);
  if (!riskNotes) return { ok: false, error: "invalid_risk_notes", status: 400 };
  const contextSummary = typeof item.contextSummary === "string" && item.contextSummary.trim() ? item.contextSummary.trim().slice(0, 2000) : "";
  if (!contextSummary) return { ok: false, error: "invalid_context_summary", status: 400 };

  const extractionConfidence = numberField(item.extractionConfidence ?? 0.97);
  const analysisConfidence = numberField(item.analysisConfidence ?? 0.9);
  if (extractionConfidence === undefined || analysisConfidence === undefined) return { ok: false, error: "invalid_confidence", status: 400 };
  if (extractionConfidence < 0 || extractionConfidence > 1 || analysisConfidence < 0 || analysisConfidence > 1) {
    return { ok: false, error: "confidence_out_of_range", status: 400 };
  }

  if (!item.contentEligibility || typeof item.contentEligibility !== "object") {
    return { ok: false, error: "invalid_content_eligibility", status: 400 };
  }
  // Structural shape only here; body quote validation happens after R2 load.
  const elig = item.contentEligibility as Record<string, unknown>;
  if (elig.version !== "standalone-v1") return { ok: false, error: "invalid_content_eligibility", status: 400 };
  if (typeof elig.format !== "string" || typeof elig.reason !== "string" || !Array.isArray(elig.bodyEvidence) || elig.bodyEvidence.length < 1 || elig.bodyEvidence.length > 5) {
    return { ok: false, error: "invalid_content_eligibility", status: 400 };
  }
  const eligibilityCandidate = item.contentEligibility as ContentEligibility;

  return {
    ok: true,
    articleId,
    provider,
    model,
    scores: typedScores,
    extractionConfidence,
    analysisConfidence,
    primaryTheme,
    secondaryThemes,
    keywords,
    evidence,
    riskNotes,
    contextSummary,
    eligibility: eligibilityCandidate,
  };
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown, min: number, max: number): string[] | undefined {
  if (!Array.isArray(value) || value.length < min || value.length > max) return undefined;
  if (!value.every((item): item is string => typeof item === "string" && !!item.trim() && item.length <= 1000)) return undefined;
  return value.map((item) => item.trim());
}

