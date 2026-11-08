import { describe, expect, it } from "vitest";
import { createPosition, readPositionAlertUpdate, readPositionEnabledUpdate } from "../server/domain/position.js";

const input = {
  name: "ETH 主区间",
  symbol: "eth/usdt",
  baseAsset: "ETH",
  quoteAsset: "USDT",
  lowerPrice: 2_000,
  upperPrice: 3_000,
  entryPrice: 2_500,
  capitalQuote: 10_000,
  feeTier: 0.003,
  alertLower: 2_100,
  alertUpper: 2_900,
};

describe("createPosition", () => {
  it("normalizes a Binance symbol and arms the new position", () => {
    const position = createPosition(input, "position-1", "2026-09-03T00:00:00.000Z");
    expect(position.symbol).toBe("ETHUSDT");
    expect(position.alertState).toEqual({ armed: true, zone: "safe" });
    expect(position.enabled).toBe(true);
  });

  it("rejects alert thresholds outside the LP range", () => {
    expect(() => createPosition({ ...input, alertUpper: 3_100 })).toThrow("预警值必须位于 LP 区间内");
  });

  it("rejects an entry price outside the LP range", () => {
    expect(() => createPosition({ ...input, entryPrice: 1_900 })).toThrow("建仓价格必须位于 LP 区间内");
  });
});

describe("readPositionEnabledUpdate", () => {
  it("accepts a boolean monitoring toggle", () => {
    expect(readPositionEnabledUpdate({ enabled: false })).toBe(false);
    expect(readPositionEnabledUpdate({ enabled: true })).toBe(true);
  });

  it("rejects LP field edits", () => {
    expect(() => readPositionEnabledUpdate({ enabled: false, alertLower: 2_200 })).toThrow("LP 不支持编辑");
    expect(() => readPositionEnabledUpdate({ name: "改名" })).toThrow("LP 不支持编辑");
  });
});

describe("readPositionAlertUpdate", () => {
  const position = createPosition(input, "position-1", "2026-09-03T00:00:00.000Z");

  it("accepts an exact pair of alert thresholds inside the LP range", () => {
    expect(readPositionAlertUpdate({ alertLower: 2_200, alertUpper: 2_800 }, position)).toEqual({
      alertLower: 2_200,
      alertUpper: 2_800,
    });
  });

  it("rejects crossings, values outside the LP range, and unrelated LP edits", () => {
    expect(() => readPositionAlertUpdate({ alertLower: 2_900, alertUpper: 2_800 }, position)).toThrow("预警值必须位于 LP 区间内");
    expect(() => readPositionAlertUpdate({ alertLower: 1_900, alertUpper: 2_800 }, position)).toThrow("预警值必须位于 LP 区间内");
    expect(() => readPositionAlertUpdate({ alertLower: 2_200, alertUpper: 2_800, name: "改名" }, position)).toThrow("仅支持调整上下预警线");
  });
});
