import { describe, expect, it } from "vitest";
import { reservoirInstanceId } from "../src/domain/cron";

describe("Reservoir cron instance ids", () => {
  it("keeps the minute so the two hourly triggers do not collide", () => {
    expect(reservoirInstanceId(Date.parse("2026-08-27T21:15:00Z"))).toBe("reservoir-202608272115");
    expect(reservoirInstanceId(Date.parse("2026-08-27T21:45:00Z"))).toBe("reservoir-202608272145");
  });

  it("is deterministic for retries of the same scheduled event", () => {
    const scheduledTime = Date.parse("2026-08-27T21:45:00Z");
    expect(reservoirInstanceId(scheduledTime)).toBe(reservoirInstanceId(scheduledTime));
  });

  it("rejects invalid scheduled timestamps", () => {
    expect(() => reservoirInstanceId(Number.NaN)).toThrow("Invalid scheduled time");
  });
});
