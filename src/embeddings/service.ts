import { embeddingProvider } from "./index";
import { projectVector } from "./math";
import { storageUsage } from "../operations/storage";

export interface StoredEmbedding {
  articleId: string;
  embeddingVersion: string;
  provider: string;
  model: string;
  dimensions: number;
  projection: number[];
  indexed: boolean;
}

export async function createAndStoreEmbedding(env: Env, input: { articleId: string; title: string; author: string; primaryTheme: string; text: string }): Promise<StoredEmbedding> {
  const existing = await embeddingForArticle(env.DB, input.articleId, String(env.EMBEDDING_VERSION));
  if (existing) return existing;
  const result = await embeddingProvider(env).embed(input.title, input.text);
  const projection = projectVector(result.values);
  const key = `embeddings/${input.articleId}/${String(env.EMBEDDING_VERSION)}.json`;
  await env.CONTENT.put(key, JSON.stringify(result.values), { httpMetadata: { contentType: "application/json" }, customMetadata: { provider: result.provider, model: result.model, dimensions: String(result.dimensions) } });
  let indexed = false;
  const isLocal = new URL(String(env.APP_ORIGIN)).hostname === "localhost";
  if (!isLocal) {
    try {
      await env.ARTICLE_VECTORS.upsert([{ id: vectorId(input.articleId, String(env.EMBEDDING_VERSION)), values: result.values, namespace: String(env.EMBEDDING_VERSION), metadata: { articleId: input.articleId, author: input.author, primaryTheme: input.primaryTheme } }]);
      indexed = true;
    } catch (error) {
      console.warn(JSON.stringify({ event: "vectorize_upsert_failed", articleId: input.articleId, message: error instanceof Error ? error.message : String(error) }));
    }
  }
  const storedVector = JSON.stringify(result.values);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO embeddings (id,article_id,embedding_version,provider,model,dimensions,vector_object_key,projection,indexed) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(article_id,embedding_version) DO NOTHING`)
      .bind(crypto.randomUUID(), input.articleId, String(env.EMBEDDING_VERSION), result.provider, result.model, result.dimensions, key, JSON.stringify(projection), indexed ? 1 : 0),
    env.DB.prepare(`INSERT INTO stored_objects (object_key,article_id,kind,size_bytes,created_at,deleted_at) VALUES (?,?,'embedding',?,CURRENT_TIMESTAMP,NULL) ON CONFLICT(object_key) DO UPDATE SET size_bytes=excluded.size_bytes,deleted_at=NULL`)
      .bind(key, input.articleId, new TextEncoder().encode(storedVector).byteLength),
  ]);
  return { articleId: input.articleId, embeddingVersion: String(env.EMBEDDING_VERSION), provider: result.provider, model: result.model, dimensions: result.dimensions, projection, indexed };
}

export async function embeddingForArticle(db: D1Database, articleId: string, embeddingVersion: string): Promise<StoredEmbedding | null> {
  const row = await db.prepare("SELECT article_id,embedding_version,provider,model,dimensions,projection,indexed FROM embeddings WHERE article_id=? AND embedding_version=?")
    .bind(articleId, embeddingVersion).first<{ article_id: string; embedding_version: string; provider: string; model: string; dimensions: number; projection: string; indexed: number }>();
  return row ? { articleId: row.article_id, embeddingVersion: row.embedding_version, provider: row.provider, model: row.model, dimensions: row.dimensions, projection: JSON.parse(row.projection) as number[], indexed: row.indexed === 1 } : null;
}

export async function projectionMap(db: D1Database, articleIds: string[], embeddingVersion: string): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  for (let offset = 0; offset < articleIds.length; offset += 90) {
    const ids = articleIds.slice(offset, offset + 90);
    if (!ids.length) continue;
    const rows = await db.prepare(`SELECT article_id,projection FROM embeddings WHERE embedding_version=? AND article_id IN (${ids.map(() => "?").join(",")})`)
      .bind(embeddingVersion, ...ids).all<{ article_id: string; projection: string }>();
    for (const row of rows.results) result.set(row.article_id, JSON.parse(row.projection) as number[]);
  }
  return result;
}

function vectorId(articleId: string, version: string): string { return `${version}:${articleId}`; }

export async function backfillMissingEmbeddings(env: Env, limit = 50): Promise<{ processed: number; failed: number; skipped?: boolean }> {
  if ((await storageUsage(env)).level === "critical") return { processed: 0, failed: 0, skipped: true };
  const rows = await env.DB.prepare(`
    SELECT a.id,a.title,a.author,a.body_key,n.primary_theme
    FROM articles a
    JOIN analyses n ON n.article_id=a.id AND n.analysis_version=?
    LEFT JOIN embeddings e ON e.article_id=a.id AND e.embedding_version=?
    WHERE a.status IN ('ready','recommended') AND a.body_key IS NOT NULL AND e.id IS NULL
    ORDER BY n.intrinsic_score DESC,a.id ASC LIMIT ?
  `).bind(String(env.ANALYSIS_VERSION), String(env.EMBEDDING_VERSION), limit).all<{ id: string; title: string; author: string; body_key: string; primary_theme: string }>();
  let processed = 0;
  let failed = 0;
  for (const row of rows.results) {
    try {
      const object = await env.CONTENT.get(row.body_key);
      if (!object) throw new Error(`Missing R2 body ${row.body_key}`);
      await createAndStoreEmbedding(env, { articleId: row.id, title: row.title, author: row.author, primaryTheme: row.primary_theme, text: await object.text() });
      processed += 1;
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({ event: "embedding_backfill_failed", articleId: row.id, message: error instanceof Error ? error.message : String(error) }));
    }
  }
  return { processed, failed };
}
