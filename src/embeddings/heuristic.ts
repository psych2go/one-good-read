import { normalizeVector } from "./math";
import type { EmbeddingProvider, EmbeddingResult } from "./provider";

export class HeuristicEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "heuristic";
  readonly model = "feature-hash-v1";
  constructor(private readonly dimensions: number) {}

  async embed(title: string, text: string): Promise<EmbeddingResult> {
    const values = Array.from({ length: this.dimensions }, () => 0);
    const tokens = `${title} ${title} ${text}`.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
    for (let index = 0; index < tokens.length; index += 1) {
      addToken(values, tokens[index] ?? "", 1);
      if (index > 0) addToken(values, `${tokens[index - 1]}_${tokens[index]}`, 0.6);
    }
    return { provider: this.provider, model: this.model, dimensions: this.dimensions, values: normalizeVector(values) };
  }
}

function addToken(values: number[], token: string, weight: number): void {
  const hash = fnv1a(token);
  const bucket = hash % values.length;
  const sign = (hash & 0x80000000) === 0 ? 1 : -1;
  values[bucket] = (values[bucket] ?? 0) + sign * weight;
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
