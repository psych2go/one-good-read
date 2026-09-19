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

import { evaluateAnalysisHealth } from "../src/operations/health";
describe("windowed analysis health", () => {
  it("alerts when the recent failure rate is at least half of processed articles", () => {
    expect(evaluateAnalysisHealth({ failed24h: 4, processed24h: 8, analyses48h: 3, pending: 50 })).toEqual({ failureRateAlert: true, stallAlert: false });
  });
  it("ignores small samples and healthy pipelines", () => {
    expect(evaluateAnalysisHealth({ failed24h: 4, processed24h: 4, analyses48h: 3, pending: 50 })).toEqual({ failureRateAlert: false, stallAlert: false });
    expect(evaluateAnalysisHealth({ failed24h: 1, processed24h: 8, analyses48h: 3, pending: 50 })).toEqual({ failureRateAlert: false, stallAlert: false });
  });
  it("alerts on a 48h stall with pending work even when the failure rate is low", () => {
    expect(evaluateAnalysisHealth({ failed24h: 0, processed24h: 0, analyses48h: 0, pending: 312 })).toEqual({ failureRateAlert: false, stallAlert: true });
  });
  it("treats zero analyses with zero pending as idle, not stalled", () => {
    expect(evaluateAnalysisHealth({ failed24h: 0, processed24h: 0, analyses48h: 0, pending: 0 })).toEqual({ failureRateAlert: false, stallAlert: false });
  });
});
