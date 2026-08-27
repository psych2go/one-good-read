import { describe, expect, it } from "vitest";
import { apiEndpoint } from "../src/ai/base-url";
describe("OpenAI-compatible API base URL", () => {
  it("joins a versioned API prefix with Responses and Embeddings resources", () => {
    expect(apiEndpoint("https://relay.example/v1/", "responses")).toBe("https://relay.example/v1/responses");
    expect(apiEndpoint("https://relay.example/v1", "embeddings")).toBe("https://relay.example/v1/embeddings");
  });
  it("rejects insecure or relative base URLs", () => expect(() => apiEndpoint("http://relay.example/v1", "responses")).toThrow(/HTTPS/));
});
