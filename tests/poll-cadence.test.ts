import { describe, expect, it } from "vitest";
import { nextPollDelay } from "../server/monitor.js";

describe("price polling cadence", () => {
  it("subtracts request time so checks keep a five-second start-to-start cadence", () => {
    expect(nextPollDelay(5_000, 1_200)).toBe(3_800);
    expect(nextPollDelay(5_000, 5_400)).toBe(0);
  });
});
