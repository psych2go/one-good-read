import { describe, expect, it } from "vitest";
import { extractWorkersAiJsonText } from "../src/ai/workers-ai";

describe("Workers AI JSON extraction", () => {
  it("reads chat.completion choices content", () => {
    expect(extractWorkersAiJsonText({
      choices: [{ message: { content: '{"ok":true,"message":"hi"}' } }],
    })).toBe('{"ok":true,"message":"hi"}');
  });
  it("reads already-parsed response object", () => {
    expect(extractWorkersAiJsonText({ response: { ok: true, message: "hi" } })).toBe('{"ok":true,"message":"hi"}');
  });
});
  it("unwraps fenced JSON and output_text", () => {
    expect(extractWorkersAiJsonText({ output_text: '```json\n{"ok":true}\n```' })).toBe('{"ok":true}');
  });
  it("reads Responses-shaped output arrays", () => {
    expect(extractWorkersAiJsonText({
      output: [{ type: "message", content: [{ type: "output_text", text: '{"ok":true}' }] }],
    })).toBe('{"ok":true}');
  });
