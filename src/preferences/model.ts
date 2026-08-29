import type { ArticleAnalysis, FeedbackKind } from "../domain/types";
import { articleFeatures, FEATURE_VERSION } from "./features";
import { predictRidge, trainRidge } from "./ridge";

export interface PreferenceModel {
  id: string;
  modelVersion: string;
  embeddingVersion: string;
  featureVersion: string;
  sampleCount: number;
  maxInfluence: number;
  weights: number[];
  mse: number;
  trainedThrough?: string;
}

interface TrainingRow {
  kind: FeedbackKind;
  created_at: string;
  author: string;
  word_count: number;
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
  article_id: string;
  projection: string;
}

export async function getOrTrainPreferenceModel(env: Env): Promise<PreferenceModel | undefined> {
  const rows = await trainingRows(env.DB, String(env.ANALYSIS_VERSION), String(env.EMBEDDING_VERSION));
  const effective = rows.filter((row) => row.kind !== "later");
  if (effective.length < 10) return undefined;
  const trainedThrough = effective.map((row) => row.created_at).sort().at(-1);
  const current = await loadActivePreferenceModel(env.DB, String(env.PREFERENCE_MODEL_VERSION), String(env.EMBEDDING_VERSION));
  if (current && current.trainedThrough === trainedThrough && current.sampleCount === effective.length) return current;
  const features = effective.map((row) => articleFeatures({ author: row.author, wordCount: row.word_count, analysis: rowAnalysis(row), projection: JSON.parse(row.projection) as number[] }));
  const labels = effective.map((row) => label(row.kind));
  const trained = trainRidge(features, labels);
  const model: PreferenceModel = { id: crypto.randomUUID(), modelVersion: String(env.PREFERENCE_MODEL_VERSION), embeddingVersion: String(env.EMBEDDING_VERSION), featureVersion: FEATURE_VERSION, sampleCount: effective.length, maxInfluence: maxInfluenceForSamples(effective.length), weights: trained.weights, mse: trained.mse, trainedThrough };
  await env.DB.batch([
    env.DB.prepare("UPDATE preference_models SET active=0 WHERE active=1"),
    env.DB.prepare(`INSERT INTO preference_models (id,model_version,embedding_version,feature_version,sample_count,max_influence,weights,metrics,trained_through,active) VALUES (?,?,?,?,?,?,?,?,?,1)`)
      .bind(model.id, model.modelVersion, model.embeddingVersion, model.featureVersion, model.sampleCount, model.maxInfluence, JSON.stringify(model.weights), JSON.stringify({ mse: model.mse, lambda: trained.lambda }), model.trainedThrough ?? null),
  ]);
  return model;
}

export function predictPersonalFit(model: PreferenceModel | undefined, input: { author: string; wordCount: number; analysis: ArticleAnalysis; projection?: number[] }): number {
  if (!model || !input.projection) return 0;
  const raw = predictRidge(model.weights, articleFeatures({ ...input, projection: input.projection }));
  return Math.tanh(raw) * model.maxInfluence * 3;
}

export function maxInfluenceForSamples(samples: number): number {
  if (samples < 10) return 0;
  if (samples < 30) return .05;
  if (samples < 60) return .1;
  if (samples < 100) return .15;
  if (samples < 200) return .2;
  return .3;
}

export async function loadActivePreferenceModel(db: D1Database, modelVersion: string, embeddingVersion: string): Promise<PreferenceModel | undefined> {
  const row = await db.prepare("SELECT * FROM preference_models WHERE active=1 AND model_version=? AND embedding_version=? ORDER BY created_at DESC LIMIT 1").bind(modelVersion, embeddingVersion)
    .first<{ id: string; model_version: string; embedding_version: string; feature_version: string; sample_count: number; max_influence: number; weights: string; metrics: string; trained_through: string | null }>();
  if (!row) return undefined;
  const metrics = JSON.parse(row.metrics) as { mse?: number };
  return { id: row.id, modelVersion: row.model_version, embeddingVersion: row.embedding_version, featureVersion: row.feature_version, sampleCount: row.sample_count, maxInfluence: row.max_influence, weights: JSON.parse(row.weights) as number[], mse: metrics.mse ?? 0, trainedThrough: row.trained_through ?? undefined };
}

async function trainingRows(db: D1Database, analysisVersion: string, embeddingVersion: string): Promise<TrainingRow[]> {
  const result = await db.prepare(`
    WITH all_feedback AS (
      SELECT f.kind,f.created_at,r.article_id
      FROM feedback f JOIN recommendations r ON r.id=f.recommendation_id
      UNION ALL
      SELECT sf.kind,sf.created_at,sr.article_id
      FROM simulation_feedback sf JOIN simulation_recommendations sr ON sr.simulation_date=sf.simulation_date
    ), latest_feedback AS (
      SELECT kind,created_at,article_id,row_number() OVER (PARTITION BY article_id ORDER BY datetime(created_at) DESC) position
      FROM all_feedback
    )
    SELECT f.kind,f.created_at,a.author,a.word_count,a.id article_id,n.*,e.projection
    FROM latest_feedback f
    JOIN articles a ON a.id=f.article_id
    JOIN analyses n ON n.article_id=a.id AND n.analysis_version=?
    JOIN embeddings e ON e.article_id=a.id AND e.embedding_version=?
    WHERE f.position=1
    ORDER BY f.created_at ASC
  `).bind(analysisVersion, embeddingVersion).all<TrainingRow>();
  return result.results;
}

function label(kind: FeedbackKind): number { return ({ valuable: 1, good: .35, not_for_me: -1, unfinished: -.45, later: 0 })[kind]; }
function rowAnalysis(row: TrainingRow): ArticleAnalysis { return { articleId: row.article_id, analysisVersion: row.analysis_version, provider: row.provider, model: row.model, intrinsicScore: row.intrinsic_score, scores: { longTermValue: row.long_term_value, ideaDensity: row.idea_density, argumentQuality: row.argument_quality, originality: row.originality, clarityStructure: row.clarity_structure }, extractionConfidence: row.extraction_confidence, analysisConfidence: row.analysis_confidence, primaryTheme: row.primary_theme, secondaryThemes: JSON.parse(row.secondary_themes) as string[], keywords: JSON.parse(row.keywords) as string[], evidence: JSON.parse(row.evidence) as string[], riskNotes: JSON.parse(row.risk_notes) as string[], contextSummary: row.context_summary }; }
