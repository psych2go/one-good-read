import type { PublicRecommendationCopy } from "../domain/types";

export function assertPublicRecommendationCopy(value: unknown): asserts value is PublicRecommendationCopy {
  if (!value || typeof value !== "object") throw new Error("Invalid public recommendation copy");
  const copy = value as Record<string, unknown>;
  const text = (item: unknown, min: number, max: number): boolean => typeof item === "string" && item.trim().length >= min && item.length <= max;
  if (!text(copy.whyWorthReading, 40, 240) || !text(copy.whyToday, 30, 200)
    || !Array.isArray(copy.keywords) || copy.keywords.length < 3 || copy.keywords.length > 5
    || !copy.keywords.every((keyword) => text(keyword, 1, 80))) throw new Error("Invalid public recommendation copy");
}
