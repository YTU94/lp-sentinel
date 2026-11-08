import { describe, expect, it } from "vitest";
import { evaluateAlert } from "../server/domain/alert-engine.js";

describe("evaluateAlert", () => {
  it("fires an upper alert once and stays silent while price remains breached", () => {
    const first = evaluateAlert({ armed: true, zone: "safe" }, 2_950, 2_100, 2_900);
    expect(first.event?.side).toBe("upper");
    expect(first.state).toEqual({ armed: false, zone: "upper" });

    const repeated = evaluateAlert(first.state, 3_020, 2_100, 2_900);
    expect(repeated.event).toBeNull();
  });

  it("rearams after returning to the safe zone", () => {
    const restored = evaluateAlert({ armed: false, zone: "lower" }, 2_500, 2_100, 2_900);
    expect(restored.event).toBeNull();
    expect(restored.state).toEqual({ armed: true, zone: "safe" });
  });

  it("fires a lower alert at the exact configured threshold", () => {
    const result = evaluateAlert({ armed: true, zone: "safe" }, 2_100, 2_100, 2_900);
    expect(result.event?.side).toBe("lower");
  });
});
