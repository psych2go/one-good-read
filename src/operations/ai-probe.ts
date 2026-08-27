import { aiProvider } from "../ai";
import { embeddingProvider } from "../embeddings";

export interface ProductionAiProbe {
  responses: { provider: string; model: string; structuredOutput: boolean; message: string };
  embedding: { provider: string; model: string; dimensions: number; norm: number };
  vectorize: { upserted: boolean; deleted: boolean };
  completedAt: string;
}

export async function probeProductionAi(env: Env): Promise<ProductionAiProbe> {
  const responses = await aiProvider(env).probe();
  if (!responses.structuredOutput) throw new Error("Responses provider did not confirm structured output support");
  const embedding = await embeddingProvider(env).embed("One Good Read probe", "Risk, uncertainty, judgment, technology, and long-term decisions.");
  const norm = Math.sqrt(embedding.values.reduce((sum, value) => sum + value * value, 0));
  const id = `probe-${crypto.randomUUID()}`;
  let upserted = false;
  let deleted = false;
  try {
    await env.ARTICLE_VECTORS.upsert([{ id, values: embedding.values, namespace: String(env.EMBEDDING_VERSION), metadata: { kind: "production-probe" } }]);
    upserted = true;
    await env.ARTICLE_VECTORS.deleteByIds([id]);
    deleted = true;
  } finally {
    if (upserted && !deleted) {
      try { await env.ARTICLE_VECTORS.deleteByIds([id]); } catch { /* best-effort probe cleanup */ }
    }
  }
  const result: ProductionAiProbe = {
    responses,
    embedding: { provider: embedding.provider, model: embedding.model, dimensions: embedding.dimensions, norm },
    vectorize: { upserted, deleted },
    completedAt: new Date().toISOString(),
  };
  await env.DB.prepare("INSERT INTO system_state (key,value,updated_at) VALUES ('production_ai_probe',?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP")
    .bind(JSON.stringify(result)).run();
  return result;
}
