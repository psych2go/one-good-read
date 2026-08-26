import { normalizeVector } from "./math";
import type { EmbeddingProvider, EmbeddingResult } from "./provider";

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "openai";
  constructor(readonly model: string, private readonly dimensions: number, private readonly apiKey: string) {}

  async embed(title: string, text: string): Promise<EmbeddingResult> {
    const chunks = chunkText(`${title}\n\n${text}`);
    const vectors: number[][] = [];
    for (let offset = 0; offset < chunks.length; offset += 16) {
      vectors.push(...await this.embedBatch(chunks.slice(offset, offset + 16)));
    }
    const averaged = Array.from({ length: this.dimensions }, () => 0);
    for (let index = 0; index < vectors.length; index += 1) {
      const weight = chunks[index]?.length ?? 1;
      const vector = vectors[index] ?? [];
      for (let dimension = 0; dimension < averaged.length; dimension += 1) averaged[dimension] = (averaged[dimension] ?? 0) + (vector[dimension] ?? 0) * weight;
    }
    return { provider: this.provider, model: this.model, dimensions: this.dimensions, values: normalizeVector(averaged) };
  }

  private async embedBatch(inputs: string[]): Promise<number[][]> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: inputs, dimensions: this.dimensions, encoding_format: "float" }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`OpenAI embeddings failed: ${response.status} ${await response.text()}`);
    const payload = await response.json<{ data: Array<{ index: number; embedding: number[] }> }>();
    return payload.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
  }
}

export function chunkText(text: string, maxChars = 16_000, overlap = 400): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);
    if (end < text.length) {
      const boundary = Math.max(text.lastIndexOf("\n", end), text.lastIndexOf(". ", end));
      if (boundary > start + maxChars * 0.6) end = boundary + 1;
    }
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}
