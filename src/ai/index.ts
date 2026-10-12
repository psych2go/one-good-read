import type { AiProvider } from "./provider";
import { HeuristicAiProvider } from "./heuristic";
import { OpenAiProvider } from "./openai";
import { WorkersAiProvider } from "./workers-ai";

export function aiProvider(env: Env): AiProvider {
  const provider = String(env.AI_PROVIDER);
  if (provider === "workers-ai") {
    return new WorkersAiProvider(env.WORKERS_AI, String(env.AI_MODEL));
  }
  if (["openai", "openai-compatible"].includes(provider)) {
    const primarySecret = Reflect.get(env, "AI_API_KEY");
    const legacySecret = Reflect.get(env, "OPENAI_API_KEY");
    const apiKey = typeof primarySecret === "string" ? primarySecret : typeof legacySecret === "string" ? legacySecret : undefined;
    if (!apiKey) throw new Error("AI_API_KEY secret is required for an OpenAI-compatible AI provider");
    return new OpenAiProvider(String(env.AI_MODEL), apiKey, String(env.AI_BASE_URL));
  }
  return new HeuristicAiProvider();
}
