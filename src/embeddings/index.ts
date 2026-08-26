import { HeuristicEmbeddingProvider } from "./heuristic";
import { OpenAiEmbeddingProvider } from "./openai";
import type { EmbeddingProvider } from "./provider";

export function embeddingProvider(env: Env): EmbeddingProvider {
  const dimensions = Number(env.EMBEDDING_DIMENSIONS);
  if (!Number.isInteger(dimensions) || dimensions <= 0) throw new Error("EMBEDDING_DIMENSIONS must be a positive integer");
  if (String(env.EMBEDDING_PROVIDER) === "openai") {
    const secret = Reflect.get(env, "OPENAI_API_KEY");
    const apiKey = typeof secret === "string" ? secret : undefined;
    if (!apiKey) throw new Error("OPENAI_API_KEY secret is required when EMBEDDING_PROVIDER=openai");
    return new OpenAiEmbeddingProvider(String(env.EMBEDDING_MODEL), dimensions, apiKey);
  }
  return new HeuristicEmbeddingProvider(dimensions);
}
