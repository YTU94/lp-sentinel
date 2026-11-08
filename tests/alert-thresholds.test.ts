import { describe, expect, it } from "vitest";
import { clampAlertThreshold, percentToPrice, priceToPercent, thresholdStep } from "../src/alert-thresholds.js";

describe("alert threshold interactions", () => {
  it("maps pointer positions and prices across the LP range", () => {
    expect(percentToPrice(25, 2_000, 3_000)).toBe(2_250);
    expect(priceToPercent(2_750, 2_000, 3_000)).toBe(75);
    expect(percentToPrice(-20, 2_000, 3_000)).toBe(2_000);
    expect(priceToPercent(3_500, 2_000, 3_000)).toBe(100);
  });

  it("keeps the lower and upper handles inside the LP range without crossing", () => {
    expect(clampAlertThreshold("lower", 2_950, {
      lowerPrice: 2_000,
      upperPrice: 3_000,
      alertLower: 2_100,
      alertUpper: 2_900,
    })).toBe(2_895);
    expect(clampAlertThreshold("upper", 2_050, {
      lowerPrice: 2_000,
      upperPrice: 3_000,
      alertLower: 2_100,
      alertUpper: 2_900,
    })).toBe(2_105);
  });

  it("uses a predictable keyboard step based on the LP range", () => {
    expect(thresholdStep(2_000, 3_000)).toBe(5);
    expect(thresholdStep(0.003, 0.005)).toBeCloseTo(0.00001, 12);
  });
});
