import type { FeedbackKind } from "./types";
export const RETRY_COOLDOWN_DAYS = 14;
export const MAX_AUTOMATIC_RETRIES = 2;

export interface RetryDecision { action: "none" | "enable" | "disable"; increment: boolean; eligibleAt?: string; }

export function retryDecision(input: { currentCount: number; kind: FeedbackKind; previousKind?: FeedbackKind; previouslyRequested: boolean; now?: Date }): RetryDecision {
  if (input.kind !== "later") return { action: "disable", increment: false };
  if (input.previousKind === "later") return { action: "none", increment: false };
  if (!input.previouslyRequested && input.currentCount >= MAX_AUTOMATIC_RETRIES) return { action: "disable", increment: false };
  const now = input.now ?? new Date();
  return { action: "enable", increment: !input.previouslyRequested, eligibleAt: new Date(now.getTime() + RETRY_COOLDOWN_DAYS * 86_400_000).toISOString() };
}

export function nextRetryState(currentCount: number, now = new Date()): { retryCount: number; eligibleAt?: string } {
  const decision = retryDecision({ currentCount, kind: "later", previouslyRequested: false, now });
  return decision.action === "enable" ? { retryCount: currentCount + 1, eligibleAt: decision.eligibleAt } : { retryCount: currentCount };
}
