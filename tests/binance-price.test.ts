import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBinancePrice } from "../server/services/binance-price.js";

describe("fetchBinancePrice", () => {
  afterEach(() => vi.restoreAllMocks());

  it("falls back to the Binance market-data domain when the primary endpoint is region blocked", async () => {
    const fetchStub = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response('{"code":0,"msg":"restricted"}', { status: 451 }))
      .mockResolvedValueOnce(new Response('{"symbol":"ETHUSDT","price":"2410.58"}', { status: 200 }));

    await expect(fetchBinancePrice("ETHUSDT")).resolves.toBe(2410.58);
    expect(fetchStub).toHaveBeenNthCalledWith(
      2,
      "https://data-api.binance.vision/api/v3/ticker/price?symbol=ETHUSDT",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
