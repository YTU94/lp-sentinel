import { describe, expect, it } from "vitest";
import { getPriceFreshness } from "../src/price-freshness.js";

describe("price freshness", () => {
  it("distinguishes current, delayed, and stale prices around a five-second poll", () => {
    const now = new Date("2026-09-03T10:00:30.000Z").getTime();
    expect(getPriceFreshness("2026-09-03T10:00:26.000Z", now)).toEqual({ state: "fresh", label: "4 秒前更新" });
    expect(getPriceFreshness("2026-09-03T10:00:18.000Z", now)).toEqual({ state: "delayed", label: "行情延迟 · 12 秒前" });
    expect(getPriceFreshness("2026-09-03T09:59:50.000Z", now)).toEqual({ state: "stale", label: "行情已过期 · 40 秒前" });
  });
});
