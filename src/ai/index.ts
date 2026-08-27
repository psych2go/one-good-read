import type { AiProvider } from "./provider";
import { HeuristicAiProvider } from "./heuristic";
import { OpenAiProvider } from "./openai";

export function aiProvider(env: Env): AiProvider {
  if (["openai", "openai-compatible"].includes(String(env.AI_PROVIDER))) {
    const primarySecret = Reflect.get(env, "AI_API_KEY");
    const legacySecret = Reflect.get(env, "OPENAI_API_KEY");
    const apiKey = typeof primarySecret === "string" ? primarySecret : typeof legacySecret === "string" ? legacySecret : undefined;
    if (!apiKey) throw new Error("AI_API_KEY secret is required for an OpenAI-compatible AI provider");
    return new OpenAiProvider(String(env.AI_MODEL), apiKey, String(env.AI_BASE_URL));
  }
  return new HeuristicAiProvider();
}
