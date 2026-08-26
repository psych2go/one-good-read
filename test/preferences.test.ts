import { describe, expect, it } from "vitest";
import { maxInfluenceForSamples } from "../src/preferences/model";
import { predictRidge, trainRidge } from "../src/preferences/ridge";
import { semanticSignals } from "../src/preferences/semantic";

describe("preference ranking", () => {
  it("learns a regularized linear preference", () => {
    const model = trainRidge([[1, 1, 0], [1, .8, .1], [1, 0, 1], [1, .1, .9]], [1, .8, -1, -.8], .1);
    expect(predictRidge(model.weights, [1, .9, .05])).toBeGreaterThan(0);
    expect(predictRidge(model.weights, [1, .05, .9])).toBeLessThan(0);
  });

  it("gates influence by feedback count", () => {
    expect(maxInfluenceForSamples(9)).toBe(0);
    expect(maxInfluenceForSamples(10)).toBe(.05);
    expect(maxInfluenceForSamples(250)).toBe(.3);
  });

  it("rewards both useful connections and genuine novelty", () => {
    const connected = semanticSignals([1, 0], [[.7, .7]]);
    const novel = semanticSignals([0, 1], [[1, 0]]);
    expect(connected.connectionBonus).toBeGreaterThan(0);
    expect(novel.explorationBonus).toBeGreaterThan(0);
  });
});
