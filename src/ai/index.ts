import type { AiProvider } from "./provider";
import { HeuristicAiProvider } from "./heuristic";
import { OpenAiProvider } from "./openai";

export function aiProvider(env: Env): AiProvider {
  if (String(env.AI_PROVIDER) === "openai") {
    const secret = Reflect.get(env, "OPENAI_API_KEY");
    const apiKey = typeof secret === "string" ? secret : undefined;
    if (!apiKey) throw new Error("OPENAI_API_KEY secret is required when AI_PROVIDER=openai");
    return new OpenAiProvider(String(env.AI_MODEL), apiKey);
  }
  return new HeuristicAiProvider();
}
