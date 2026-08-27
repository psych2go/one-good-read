import { describe, expect, it } from "vitest";
import { consecutiveDateStreak } from "../src/domain/simulation";
describe("simulation consecutive-day streak", () => {
  it("counts a descending consecutive run from the latest date", () => expect(consecutiveDateStreak(["2026-08-24","2026-08-25","2026-08-26","2026-08-27"])).toBe(4));
  it("stops at the first missing day", () => expect(consecutiveDateStreak(["2026-08-27","2026-08-26","2026-08-24","2026-08-23"])).toBe(2));
  it("deduplicates repeated dates", () => expect(consecutiveDateStreak(["2026-08-27","2026-08-27","2026-08-26"])).toBe(2));
});
