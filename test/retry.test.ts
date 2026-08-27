import { describe, expect, it } from "vitest";
import { MAX_AUTOMATIC_RETRIES, nextRetryState, retryDecision } from "../src/domain/retry";
describe("later retry state", () => {
  it("uses a fourteen-day cooldown", () => {
    const state = nextRetryState(0, new Date("2026-08-01T00:00:00Z"));
    expect(state.retryCount).toBe(1);
    expect(state.eligibleAt).toBe("2026-08-15T00:00:00.000Z");
  });
  it("does not consume another retry for duplicate feedback on the same recommendation", () => {
    expect(retryDecision({ currentCount: 1, kind: "later", previousKind: "later", previouslyRequested: true }).action).toBe("none");
    expect(retryDecision({ currentCount: 1, kind: "later", previousKind: "good", previouslyRequested: true }).increment).toBe(false);
  });
  it("stops new recommendation retries after two", () => expect(nextRetryState(MAX_AUTOMATIC_RETRIES).eligibleAt).toBeUndefined());
});
