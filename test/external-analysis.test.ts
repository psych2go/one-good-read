import { describe, expect, it } from "vitest";
import { weightedIntrinsicScore } from "../src/domain/scoring";
import { parseContentEligibility } from "../src/domain/content-gate";

describe("external analysis payload shape", () => {
  it("accepts standalone eligibility with body quotes", () => {
    const body = "It is sort of the job of big US banks to catch terrorists and drug dealers, but not all of them. You gotta set the dial right.";
    const eligibility = parseContentEligibility({
      version: "standalone-v1",
      format: "standalone_essay",
      reason: "Full newsletter essay with independent analysis.",
      bodyEvidence: [
        "It is sort of the job of big US banks to catch terrorists and drug dealers, but not all of them.",
        "You gotta set the dial right.",
      ],
    }, body);
    expect(eligibility?.format).toBe("standalone_essay");
    expect(weightedIntrinsicScore({ longTermValue: 7.8, ideaDensity: 8.2, argumentQuality: 8.0, originality: 7.5, clarityStructure: 8.5 })).toBeGreaterThanOrEqual(7.5);
  });
});
