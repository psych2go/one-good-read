import { describe, expect, it } from "vitest";
import { nextBackfillMonitorState } from "../src/operations/health";
describe("backfill monitor progress", () => {
  it("advances lastProgressAt when ready count grows", () => {
    const state = nextBackfillMonitorState({ ready: 10, failed: 1, checkedAt: "2026-08-27T00:00:00.000Z", lastProgressAt: "2026-08-27T00:00:00.000Z" }, 11, 1, new Date("2026-08-27T01:00:00Z"));
    expect(state.lastProgressAt).toBe("2026-08-27T01:00:00.000Z");
  });
  it("preserves last progress time while the pool is unchanged", () => {
    const state = nextBackfillMonitorState({ ready: 10, failed: 1, checkedAt: "2026-08-27T00:00:00.000Z", lastProgressAt: "2026-08-26T23:00:00.000Z" }, 10, 2, new Date("2026-08-27T01:00:00Z"));
    expect(state.lastProgressAt).toBe("2026-08-26T23:00:00.000Z");
  });
});
