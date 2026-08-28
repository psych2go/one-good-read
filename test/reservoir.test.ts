import { describe, expect, it } from "vitest";
import { nextHistoryPages, selectReservoirSources, smoothedAcceptance } from "../src/domain/reservoir";
describe("reservoir history depth", () => {
  it("keeps the current depth while enough pending articles remain", () => expect(nextHistoryPages(5, 20)).toBe(5));
  it("expands history gradually when the pending queue is low", () => { expect(nextHistoryPages(5, 2)).toBe(7); expect(nextHistoryPages(99, 0)).toBe(100); });
});
describe("reservoir source selection", () => {
  const now = new Date("2026-08-27T12:00:00Z");
  const candidates = [
    { id: "high-a", pending: 20, ready: 18, rejected: 2, lastScannedAt: "2026-08-27T11:00:00Z" },
    { id: "high-b", pending: 20, ready: 12, rejected: 3, lastScannedAt: "2026-08-27T10:00:00Z" },
    { id: "medium", pending: 20, ready: 5, rejected: 5, lastScannedAt: "2026-08-27T09:00:00Z" },
    { id: "old-explore", pending: 20, ready: 0, rejected: 12, lastScannedAt: "2026-08-25T00:00:00Z" },
    { id: "low", pending: 20, ready: 0, rejected: 20, lastScannedAt: "2026-08-27T08:00:00Z" },
  ];
  it("uses three exploitation slots and one oldest-source exploration slot", () => expect(selectReservoirSources(candidates, 4, now).map((item) => item.id)).toEqual(["high-a", "high-b", "medium", "old-explore"]));

  it("uses the exploration slot to deepen an old source whose current queue is empty", () => {
    const withEmptyOldest = [...candidates, { id: "empty-oldest", pending: 0, ready: 0, rejected: 0, lastScannedAt: "2026-08-20T00:00:00Z" }];
    expect(selectReservoirSources(withEmptyOldest, 4, now).map((item) => item.id)).toEqual(["high-a", "high-b", "medium", "empty-oldest"]);
  });

  it("rotates across multiple empty sources when all current queues are exhausted", () => {
    const empty = [
      { id: "oldest", pending: 0, ready: 2, rejected: 4, lastScannedAt: "2026-08-20T00:00:00Z" },
      { id: "older", pending: 0, ready: 3, rejected: 2, lastScannedAt: "2026-08-21T00:00:00Z" },
      { id: "newer", pending: 0, ready: 1, rejected: 1, lastScannedAt: "2026-08-22T00:00:00Z" },
    ];
    expect(selectReservoirSources(empty, 2, now).map((item) => item.id)).toEqual(["oldest", "older"]);
  });
  it("smooths low-sample acceptance rates", () => { expect(smoothedAcceptance({ ready: 0, rejected: 0 })).toBe(.5); expect(smoothedAcceptance({ ready: 8, rejected: 2 })).toBe(.75); });
});
