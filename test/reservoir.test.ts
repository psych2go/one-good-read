import { describe, expect, it } from "vitest";
import { nextHistoryPages } from "../src/domain/reservoir";
describe("reservoir history depth", () => {
  it("keeps the current depth while enough pending articles remain", () => expect(nextHistoryPages(5, 20)).toBe(5));
  it("expands history gradually when the pending queue is low", () => { expect(nextHistoryPages(5, 2)).toBe(7); expect(nextHistoryPages(99, 0)).toBe(100); });
});
