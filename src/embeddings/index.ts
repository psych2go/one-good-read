import { HeuristicEmbeddingProvider } from "./heuristic";
import { OpenAiEmbeddingProvider } from "./openai";
import type { EmbeddingProvider } from "./provider";
import { WorkersAiEmbeddingProvider } from "./workers-ai";

export function embeddingProvider(env: Env): EmbeddingProvider {
  const dimensions = Number(env.EMBEDDING_DIMENSIONS);
  if (!Number.isInteger(dimensions) || dimensions <= 0) throw new Error("EMBEDDING_DIMENSIONS must be a positive integer");
  if (String(env.EMBEDDING_PROVIDER) === "workers-ai") return new WorkersAiEmbeddingProvider(env.WORKERS_AI, String(env.EMBEDDING_MODEL), dimensions);
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
