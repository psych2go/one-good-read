import { describe, expect, it } from "vitest";
import { apiEndpoint } from "../src/ai/base-url";
describe("OpenAI-compatible API base URL", () => {
  it("joins a versioned API prefix with Responses and Embeddings resources", () => {
    expect(apiEndpoint("https://relay.example/v1/", "responses")).toBe("https://relay.example/v1/responses");
    expect(apiEndpoint("https://relay.example/v1", "embeddings")).toBe("https://relay.example/v1/embeddings");
  });
  it("rejects insecure or relative base URLs", () => expect(() => apiEndpoint("http://relay.example/v1", "responses")).toThrow(/HTTPS/));
});

describe("long article analysis chunking", () => {
  it("covers the complete article with bounded overlapping chunks", async () => {
    const { chunkForAnalysis } = await import("../src/ai/openai");
    const text = `${"argument sentence. ".repeat(3_000)}FINAL`;
    const chunks = chunkForAnalysis(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThanOrEqual(18_000);
    expect(chunks.at(-1)?.endsWith("FINAL")).toBe(true);
  });
});
