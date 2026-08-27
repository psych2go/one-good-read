import { describe, expect, it } from "vitest";
import { storageLevel } from "../src/operations/storage";
describe("storage safety levels", () => {
  it("warns at 70% and pauses at 85%", () => {
    expect(storageLevel(.69)).toBe("ok");
    expect(storageLevel(.7)).toBe("warning");
    expect(storageLevel(.85)).toBe("critical");
  });
});
