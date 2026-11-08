import { describe, expect, it } from "vitest";
import { searchBinanceSymbols } from "../server/services/binance-symbol-search.js";

describe("Binance symbol search", () => {
  it("returns matching spot pairs with live prices and prioritizes an exact base asset", async () => {
    const responses = [
      {
        symbols: [
          { symbol: "WETHUSDT", baseAsset: "WETH", quoteAsset: "USDT", status: "TRADING", isSpotTradingAllowed: true },
          { symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT", status: "TRADING", isSpotTradingAllowed: true },
          { symbol: "ETHBTC", baseAsset: "ETH", quoteAsset: "BTC", status: "TRADING", isSpotTradingAllowed: true },
          { symbol: "ETHDOWNUSDT", baseAsset: "ETHDOWN", quoteAsset: "USDT", status: "BREAK", isSpotTradingAllowed: true },
        ],
      },
      [
        { symbol: "ETHUSDT", price: "2412.50" },
        { symbol: "ETHBTC", price: "0.053" },
        { symbol: "WETHUSDT", price: "2411.90" },
      ],
    ];
    const fetcher: typeof fetch = async () => new Response(JSON.stringify(responses.shift()), { status: 200 });

    const results = await searchBinanceSymbols("eth", fetcher);

    expect(results).toEqual([
      { symbol: "ETHUSDT", baseAsset: "ETH", quoteAsset: "USDT", price: 2412.5 },
      { symbol: "ETHBTC", baseAsset: "ETH", quoteAsset: "BTC", price: 0.053 },
      { symbol: "WETHUSDT", baseAsset: "WETH", quoteAsset: "USDT", price: 2411.9 },
    ]);
  });

  it("returns no candidates until two characters are entered", async () => {
    const fetcher: typeof fetch = async () => { throw new Error("should not fetch"); };
    expect(await searchBinanceSymbols("e", fetcher)).toEqual([]);
  });
});
