import { describe, expect, it } from "vitest";
import { simulateConcentratedPosition } from "../server/domain/lp-math.js";

describe("simulateConcentratedPosition", () => {
  it("converts the position entirely to quote asset above the upper bound", () => {
    const result = simulateConcentratedPosition({
      capitalQuote: 10_000,
      currentPrice: 3_200,
      referencePrice: 2_500,
      lowerPrice: 2_000,
      upperPrice: 3_000,
    });

    expect(result.status).toBe("above");
    expect(result.baseAmount).toBe(0);
    expect(result.quoteAmount).toBeGreaterThan(0);
  });

  it("converts the position entirely to base asset below the lower bound", () => {
    const result = simulateConcentratedPosition({
      capitalQuote: 10_000,
      currentPrice: 1_800,
      referencePrice: 2_500,
      lowerPrice: 2_000,
      upperPrice: 3_000,
    });

    expect(result.status).toBe("below");
    expect(result.quoteAmount).toBe(0);
    expect(result.baseAmount).toBeGreaterThan(0);
  });

  it("holds both assets while price is inside the configured range", () => {
    const result = simulateConcentratedPosition({
      capitalQuote: 10_000,
      currentPrice: 2_500,
      referencePrice: 2_500,
      lowerPrice: 2_000,
      upperPrice: 3_000,
    });

    expect(result.status).toBe("in-range");
    expect(result.baseAmount).toBeGreaterThan(0);
    expect(result.quoteAmount).toBeGreaterThan(0);
    expect(result.progress).toBeGreaterThan(0);
    expect(result.progress).toBeLessThan(1);
  });
});
