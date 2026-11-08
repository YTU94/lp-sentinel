import { describe, expect, it } from "vitest";
import { suggestAlertThresholds } from "../server/domain/smart-alerts.js";

describe("smart LP alert defaults", () => {
  it("places warnings twelve and a half percent inside a typical concentrated range", () => {
    const alerts = suggestAlertThresholds({
      tickLower: -199_097,
      tickUpper: -197_771,
      tickSpacing: 1,
      decimals0: 18,
      decimals1: 6,
    });

    expect(alerts.bufferRatio).toBe(0.125);
    expect(alerts.warningLowerTick).toBe(-198_931);
    expect(alerts.warningUpperTick).toBe(-197_937);
    expect(alerts.alertLower).toBeCloseTo(2295.981511, 6);
    expect(alerts.alertUpper).toBeCloseTo(2535.917377, 6);
    expect(alerts.confirmations).toBe(3);
    expect(alerts.pollIntervalSeconds).toBe(300);
    expect(alerts.cooldownSeconds).toBe(14_400);
  });

  it("uses an earlier warning for very narrow ranges", () => {
    const alerts = suggestAlertThresholds({
      tickLower: 10_000,
      tickUpper: 10_400,
      tickSpacing: 10,
      decimals0: 18,
      decimals1: 18,
    });

    expect(alerts.bufferRatio).toBe(0.2);
    expect(alerts.warningLowerTick).toBe(10_080);
    expect(alerts.warningUpperTick).toBe(10_320);
  });

  it("keeps warnings near the edges for wide ranges", () => {
    const alerts = suggestAlertThresholds({
      tickLower: 10_000,
      tickUpper: 14_000,
      tickSpacing: 10,
      decimals0: 18,
      decimals1: 18,
    });

    expect(alerts.bufferRatio).toBe(0.08);
    expect(alerts.warningLowerTick).toBe(10_320);
    expect(alerts.warningUpperTick).toBe(13_680);
  });
});
