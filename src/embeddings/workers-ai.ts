import { normalizeVector } from "./math";
import type { EmbeddingProvider, EmbeddingResult } from "./provider";

export class WorkersAiEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "workers-ai";
  constructor(private readonly ai: Ai, readonly model: string, private readonly dimensions: number) {}

  async embed(title: string, text: string): Promise<EmbeddingResult> {
    const chunks = chunkForWorkersAi(`${title}\n\n${text}`);
    const vectors: number[][] = [];
    for (let offset = 0; offset < chunks.length; offset += 32) {
      const batch = chunks.slice(offset, offset + 32);
      const output = await this.ai.run(this.model, { text: batch, pooling: "cls" }, { signal: AbortSignal.timeout(60_000), tags: ["one-good-read", "embedding"] });
      const data = embeddingData(output);
      if (data.length !== batch.length) throw new Error(`Workers AI returned ${data.length} embeddings for ${batch.length} chunks`);
      vectors.push(...data);
    }
    const averaged = Array.from({ length: this.dimensions }, () => 0);
    for (let index = 0; index < vectors.length; index += 1) {
      const vector = vectors[index] ?? [];
      if (vector.length !== this.dimensions) throw new Error(`Workers AI embedding dimension ${vector.length} does not match configured ${this.dimensions}`);
      const weight = chunks[index]?.length ?? 1;
      for (let dimension = 0; dimension < averaged.length; dimension += 1) averaged[dimension] = (averaged[dimension] ?? 0) + (vector[dimension] ?? 0) * weight;
    }
    return { provider: this.provider, model: this.model, dimensions: this.dimensions, values: normalizeVector(averaged) };
  }
}

export function chunkForWorkersAi(text: string, maxChars = 1_400, overlap = 100): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) {
      const boundary = Math.max(text.lastIndexOf("\n", end), text.lastIndexOf(". ", end));
      if (boundary > start + maxChars * .55) end = boundary + 1;
    }
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

function embeddingData(output: Record<string, unknown>): number[][] {
  const data = output.data;
  if (!Array.isArray(data) || !data.every((row) => Array.isArray(row) && row.every((value) => typeof value === "number"))) throw new Error("Workers AI embedding response did not contain numeric data[][]");
  return data;
}
