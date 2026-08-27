import { describe, expect, it } from "vitest";
import { HeuristicEmbeddingProvider } from "../src/embeddings/heuristic";
import { cosineSimilarity, projectVector } from "../src/embeddings/math";
import { chunkText } from "../src/embeddings/openai";

describe("embeddings", () => {
  it("produces deterministic normalized vectors", async () => {
    const provider = new HeuristicEmbeddingProvider(384);
    const first = await provider.embed("Risk", "Risk and uncertainty require judgment over time.");
    const second = await provider.embed("Risk", "Risk and uncertainty require judgment over time.");
    expect(first.values).toEqual(second.values);
    expect(Math.sqrt(first.values.reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1, 6);
  });

  it("keeps related text closer than unrelated text", async () => {
    const provider = new HeuristicEmbeddingProvider(384);
    const risk = await provider.embed("Risk", "risk uncertainty probability investing loss return");
    const similar = await provider.embed("Uncertainty", "investing risk probability loss and return");
    const unrelated = await provider.embed("Writing", "sentences prose editing grammar and paragraphs");
    expect(cosineSimilarity(risk.values, similar.values)).toBeGreaterThan(cosineSimilarity(risk.values, unrelated.values));
    expect(projectVector(risk.values)).toHaveLength(64);
  });

  it("chunks long text without dropping its ending", () => {
    const text = `${"a".repeat(20_000)}\n${"z".repeat(20_000)}`;
    const chunks = chunkText(text, 16_000, 400);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.at(-1)?.endsWith("z")).toBe(true);
  });
});

describe("Workers AI embedding chunking", () => {
  it("keeps chunks within the small embedding model context budget", async () => {
    const { chunkForWorkersAi } = await import("../src/embeddings/workers-ai");
    const text = `${"paragraph words. ".repeat(500)}END`;
    const chunks = chunkForWorkersAi(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThanOrEqual(1_400);
    expect(chunks.at(-1)?.endsWith("END")).toBe(true);
  });
});
