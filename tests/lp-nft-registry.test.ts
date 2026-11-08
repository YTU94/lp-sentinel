import { describe, expect, it, vi } from "vitest";
import { detectLpNft, type LpNftAdapter } from "../server/services/lp-nft-registry.js";
import type { LiveLpPosition } from "../server/domain/live-lp.js";

function livePosition(sourceId: LiveLpPosition["sourceId"], tokenId = "7314935"): LiveLpPosition {
  const isBase = sourceId === "base-uniswap-v3";
  return {
    sourceId,
    networkName: isBase ? "Base" : sourceId === "bsc-pancake-v3" ? "BNB Chain" : "Robinhood Chain",
    tokenId,
    chainId: isBase ? 8453 : sourceId === "bsc-pancake-v3" ? 56 : 4663,
    protocol: sourceId === "bsc-pancake-v3" ? "PancakeSwap V3" : "Uniswap v3",
    positionManager: "0x0000000000000000000000000000000000000001",
    owner: "0x0000000000000000000000000000000000000002",
    pool: "0x0000000000000000000000000000000000000003",
    token0: "0x0000000000000000000000000000000000000004",
    token1: "0x0000000000000000000000000000000000000005",
    symbol0: "AAA",
    symbol1: "BBB",
    decimals0: 18,
    decimals1: 18,
    fee: 2_500,
    tickSpacing: 50,
    tickLower: -100,
    currentTick: 0,
    tickUpper: 100,
    liquidity: "1000",
    tokensOwed0: "0",
    tokensOwed1: "0",
    formattedOwed0: "0",
    formattedOwed1: "0",
    amount0: 1,
    amount1: 1,
    positionValueQuote: 2,
    currentPrice: 1,
    lowerPrice: 0.99,
    upperPrice: 1.01,
    status: "in-range",
    blockNumber: "100",
    updatedAt: "2026-09-04T00:00:00.000Z",
    alertRecommendation: { alertLower: 0.992, alertUpper: 1.008, warningLowerTick: -80, warningUpperTick: 80, bufferRatio: 0.2, confirmations: 3, sampleIntervalSeconds: 300, cooldownSeconds: 14_400 },
    explorerUrl: "https://example.test/position/7314935",
  };
}

function adapter(sourceId: LiveLpPosition["sourceId"], read: LpNftAdapter["read"]): LpNftAdapter {
  const isBase = sourceId === "base-uniswap-v3";
  return {
    sourceId,
    networkName: isBase ? "Base" : sourceId === "bsc-pancake-v3" ? "BNB Chain" : "Robinhood Chain",
    protocol: sourceId === "bsc-pancake-v3" ? "PancakeSwap V3" : "Uniswap v3",
    read,
  };
}

describe("multi-network LP NFT detection", () => {
  it("returns the matching protocol and a concise miss diagnosis for the other network", async () => {
    const robinhoodRead = vi.fn(async () => { throw new Error("ERC721: owner query for nonexistent token"); });
    const pancakePosition = livePosition("bsc-pancake-v3");
    const result = await detectLpNft("7314935", [
      adapter("robinhood-uniswap-v3", robinhoodRead),
      adapter("bsc-pancake-v3", async () => pancakePosition),
    ]);

    expect(result.matches).toEqual([pancakePosition]);
    expect(result.probes).toEqual([
      { sourceId: "robinhood-uniswap-v3", networkName: "Robinhood Chain", protocol: "Uniswap v3", status: "not-found", message: "该平台未找到此 NFT" },
      { sourceId: "bsc-pancake-v3", networkName: "BNB Chain", protocol: "PancakeSwap V3", status: "matched" },
    ]);
  });

  it("keeps every match when the same numeric NFT id exists on multiple networks", async () => {
    const result = await detectLpNft("984513", [
      adapter("robinhood-uniswap-v3", async () => livePosition("robinhood-uniswap-v3", "984513")),
      adapter("bsc-pancake-v3", async () => livePosition("bsc-pancake-v3", "984513")),
      adapter("base-uniswap-v3", async () => livePosition("base-uniswap-v3", "984513")),
    ]);

    expect(result.matches.map((item) => item.sourceId)).toEqual(["robinhood-uniswap-v3", "bsc-pancake-v3", "base-uniswap-v3"]);
  });

  it("rejects malformed ids before probing any network", async () => {
    const read = vi.fn();
    await expect(detectLpNft("7x", [adapter("bsc-pancake-v3", read)])).rejects.toThrow("NFT ID 必须是正整数");
    expect(read).not.toHaveBeenCalled();
  });
});
