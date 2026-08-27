import { HeuristicEmbeddingProvider } from "./heuristic";
import { OpenAiEmbeddingProvider } from "./openai";
import type { EmbeddingProvider } from "./provider";

export function embeddingProvider(env: Env): EmbeddingProvider {
  const dimensions = Number(env.EMBEDDING_DIMENSIONS);
  if (!Number.isInteger(dimensions) || dimensions <= 0) throw new Error("EMBEDDING_DIMENSIONS must be a positive integer");
  if (["openai", "openai-compatible"].includes(String(env.EMBEDDING_PROVIDER))) {
    const primarySecret = Reflect.get(env, "AI_API_KEY");
    const legacySecret = Reflect.get(env, "OPENAI_API_KEY");
    const apiKey = typeof primarySecret === "string" ? primarySecret : typeof legacySecret === "string" ? legacySecret : undefined;
    if (!apiKey) throw new Error("AI_API_KEY secret is required for an OpenAI-compatible embedding provider");
    const baseUrl = String(env.EMBEDDING_BASE_URL).trim() || String(env.AI_BASE_URL);
    return new OpenAiEmbeddingProvider(String(env.EMBEDDING_MODEL), dimensions, apiKey, baseUrl);
  }
  return new HeuristicEmbeddingProvider(dimensions);
}
