import { describe, expect, it } from "vitest";
import { applyTokenCandidate, formatTokenPrice } from "../src/token-selection.js";

describe("token candidate selection", () => {
  it("fills the pair assets and uses live price for entry and a practical initial range", () => {
    const next = applyTokenCandidate({
      name: "自定义仓位",
      symbol: "ETH",
      baseAsset: "",
      quoteAsset: "",
      lowerPrice: 0,
      upperPrice: 0,
      entryPrice: 0,
      capitalQuote: 10_000,
      feeTier: 0.003,
      alertLower: 0,
      alertUpper: 0,
    }, { symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT", price: 2500 });

    expect(next).toMatchObject({
      symbol: "ETHUSDT",
      baseAsset: "ETH",
      quoteAsset: "USDT",
      entryPrice: 2500,
      lowerPrice: 2000,
      upperPrice: 3000,
      alertLower: 2100,
      alertUpper: 2900,
    });
  });
});

describe("token price formatting", () => {
  it("keeps small live prices visible instead of rounding them to zero", () => {
    expect(formatTokenPrice(0.00123456)).toBe("0.001235");
    expect(formatTokenPrice(100.7)).toBe("100.70");
  });
});
