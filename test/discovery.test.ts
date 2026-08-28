import { describe, expect, it } from "vitest";
import { discoveryPageWindow } from "../src/domain/discovery";

describe("bounded historical discovery windows", () => {
  it("fetches every page while the depth is small", () => {
    expect(discoveryPageWindow(5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("keeps page one and a bounded overlapping frontier window", () => {
    expect(discoveryPageWindow(7)).toEqual([1, 4, 5, 6, 7]);
    expect(discoveryPageWindow(45)).toEqual([1, 42, 43, 44, 45]);
  });

  it("honors a one-request safety cap", () => {
    expect(discoveryPageWindow(50, 1)).toEqual([1]);
  });
});
