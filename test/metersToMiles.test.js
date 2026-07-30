import { describe, it, expect } from "vitest";
import { metersToMiles } from "../lib/logic.js";

describe("metersToMiles", () => {
  it("converts a known distance (1 mile in meters)", () => {
    expect(metersToMiles(1609.344)).toBeCloseTo(1, 9);
  });

  it("returns 0 for 0 meters", () => {
    expect(metersToMiles(0)).toBe(0);
  });

  it("treats garbage input (NaN, undefined, a string) as 0", () => {
    expect(metersToMiles(NaN)).toBe(0);
    expect(metersToMiles(undefined)).toBe(0);
    expect(metersToMiles("not a number")).toBe(0);
  });

  it("accepts a numeric string, same as the rest of this codebase's Number(x)||0 convention", () => {
    expect(metersToMiles("1609.344")).toBeCloseTo(1, 9);
  });
});
