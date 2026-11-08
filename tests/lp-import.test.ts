import { describe, expect, it } from "vitest";
import { chainSnapshotFromLiveLp, positionInputFromLiveLp } from "../server/domain/live-lp-import.js";

describe("live LP monitoring import", () => {
  it("preserves a sanitized lifecycle-unavailable reason in the chain snapshot", () => {
    const snapshot = chainSnapshotFromLiveLp({
      currentPrice: 2,
      amount0: 1,
      amount1: 2,
      positionValueQuote: 4,
      formattedOwed0: "0",
      formattedOwed1: "0",
      blockNumber: "10",
      updatedAt: "2026-09-07T00:00:00.000Z",
      lifecycleUnavailableReason: "配置 BSC_HISTORY_RPC_URL 后会自动回填。",
    } as Parameters<typeof chainSnapshotFromLiveLp>[0], "AAA", "BBB");

    expect(snapshot.analytics).toBeUndefined();
    expect(snapshot.analyticsUnavailableReason).toBe("配置 BSC_HISTORY_RPC_URL 后会自动回填。");
  });

  it("turns NFT lifecycle events into Revert-style performance, fee and range metrics", () => {
    const snapshot = chainSnapshotFromLiveLp({
      currentPrice: 2,
      amount0: 40,
      amount1: 30,
      positionValueQuote: 110,
      formattedOwed0: "3",
      formattedOwed1: "4",
      blockNumber: "200",
      updatedAt: "2026-09-03T00:00:00.000Z",
      networkName: "Robinhood Chain",
      protocol: "Uniswap v3",
      pool: "0x0000000000000000000000000000000000000003",
      fee: 3_000,
      liquidity: "123456",
      tickLower: -100,
      currentTick: 0,
      tickUpper: 100,
      status: "in-range",
      lifecycle: {
        createdAt: "2026-09-01T00:00:00.000Z",
        ageSeconds: 172_800,
        eventCount: 4,
        deposited0: 100,
        deposited1: 100,
        withdrawn0: 20,
        withdrawn1: 10,
        collected0: 25,
        collected1: 13,
        claimedFees0: 5,
        claimedFees1: 3,
        unclaimedFees0: 3,
        unclaimedFees1: 4,
        totalFees0: 8,
        totalFees1: 7,
        pendingRemoved0: 0,
        pendingRemoved1: 0,
        depositedValueQuote: 500,
        withdrawnValueQuote: 190,
        collectedValueQuote: 413,
        claimedFeesValueQuote: 83,
        gasSpentNative: 0.002,
        nativeSymbol: "ETH",
      },
    } as Parameters<typeof chainSnapshotFromLiveLp>[0], "AAA", "BBB");

    expect(snapshot.market).toEqual({
      networkName: "Robinhood Chain",
      protocol: "Uniswap v3",
      pool: "0x0000000000000000000000000000000000000003",
      feeTierPercent: 0.3,
      liquidity: "123456",
      tickLower: -100,
      currentTick: 0,
      tickUpper: 100,
      status: "in-range",
    });
    expect(snapshot.analytics).toMatchObject({
      createdAt: "2026-09-01T00:00:00.000Z",
      ageSeconds: 172_800,
      eventCount: 4,
      depositedValueQuote: 500,
      withdrawnValueQuote: 190,
      collectedValueQuote: 413,
      lifetimeFeesValueQuote: 93,
      averageDailyFeesQuote: 46.5,
      holdValueQuote: 500,
      divergencePnlQuote: -70,
      poolPnlQuote: 23,
      gasSpentNative: 0.002,
      nativeSymbol: "ETH",
    });
    expect(snapshot.analytics?.roiPercent).toBeCloseTo(4.6, 8);
    expect(snapshot.analytics?.lifetimeFeeAprPercent).toBeCloseTo(3394.5, 8);
    expect(snapshot.analytics?.deposited.map((item) => item.amount)).toEqual([100, 100]);
    expect(snapshot.analytics?.withdrawn.map((item) => item.amount)).toEqual([20, 10]);
    expect(snapshot.analytics?.collected.map((item) => item.amount)).toEqual([25, 13]);
    expect(snapshot.analytics?.lifetimeFees.map((item) => item.amount)).toEqual([8, 7]);
  });

  it("uses chain prices and smart recommendations as the default alert configuration", () => {
    const input = positionInputFromLiveLp({
      sourceId: "robinhood-uniswap-v3",
      networkName: "Robinhood Chain",
      tokenId: "984513",
      chainId: 4663,
      protocol: "Uniswap v3",
      positionManager: "0x73991a25c818bf1f1128deaab1492d45638de0d3",
      pool: "0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca",
      owner: "0x1cd9254318c82e88432b47c6e0b94038b52a2558",
      symbol0: "WETH",
      symbol1: "USDG",
      fee: 100,
      lowerPrice: 2258.184689,
      currentPrice: 2401.850661,
      upperPrice: 2578.362806,
      positionValueQuote: 1_025.5,
      alertRecommendation: {
        alertLower: 2295.981511,
        alertUpper: 2535.917377,
      },
    });

    expect(input).toMatchObject({
      name: "WETH / USDG · NFT #984513",
      symbol: "WETHUSDG",
      baseAsset: "WETH",
      quoteAsset: "USDG",
      lowerPrice: 2258.184689,
      upperPrice: 2578.362806,
      entryPrice: 2401.850661,
      capitalQuote: 1025.5,
      feeTier: 0.0001,
      alertLower: 2295.981511,
      alertUpper: 2535.917377,
      source: {
        type: "robinhood-uniswap-v3",
        chainId: 4663,
        tokenId: "984513",
      },
    });
  });

  it("preserves a BNB Chain PancakeSwap source for future monitoring", () => {
    const input = positionInputFromLiveLp({
      sourceId: "bsc-pancake-v3",
      networkName: "BNB Chain",
      tokenId: "7314935",
      chainId: 56,
      protocol: "PancakeSwap V3",
      positionManager: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
      pool: "0x0000000000000000000000000000000000000003",
      owner: "0x0000000000000000000000000000000000000004",
      symbol0: "WBNB",
      symbol1: "SPCXB",
      fee: 2_500,
      lowerPrice: 0.9,
      currentPrice: 1,
      upperPrice: 1.1,
      positionValueQuote: 100,
      alertRecommendation: { alertLower: 0.92, alertUpper: 1.08 },
    });

    expect(input.source).toMatchObject({ type: "bsc-pancake-v3", chainId: 56, tokenId: "7314935" });
    expect(input.name).toBe("WBNB / SPCXB · NFT #7314935");
  });

  it("preserves a Base Uniswap V3 source for future monitoring", () => {
    const input = positionInputFromLiveLp({
      sourceId: "base-uniswap-v3",
      networkName: "Base",
      tokenId: "123456",
      chainId: 8453,
      protocol: "Uniswap v3",
      positionManager: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
      pool: "0x0000000000000000000000000000000000000003",
      owner: "0x0000000000000000000000000000000000000004",
      symbol0: "WETH",
      symbol1: "USDC",
      fee: 500,
      lowerPrice: 2_300,
      currentPrice: 2_500,
      upperPrice: 2_700,
      positionValueQuote: 100,
      alertRecommendation: { alertLower: 2_340, alertUpper: 2_660 },
    });

    expect(input.source).toMatchObject({ type: "base-uniswap-v3", chainId: 8453, tokenId: "123456" });
    expect(input.name).toBe("WETH / USDC · NFT #123456");
  });
});
