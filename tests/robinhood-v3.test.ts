import { describe, expect, it, vi } from "vitest";
import {
  ROBINHOOD_UNISWAP_V3,
  createRobinhoodRpcClient,
  readRobinhoodV3Position,
} from "../server/services/robinhood-v3.js";

describe("Robinhood Uniswap v3 position lookup", () => {
  it("batches concurrent public RPC reads to avoid triggering provider rate limits", async () => {
    const requests: unknown[] = [];
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      const batch = Array.isArray(body) ? body : [body];
      return new Response(JSON.stringify(batch.map((request) => ({
        jsonrpc: "2.0",
        id: request.id,
        result: "0x2a",
      }))), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const rpcClient = createRobinhoodRpcClient({
      rpcUrl: "https://rpc.invalid",
      fetchFn: fetchFn as typeof fetch,
    });

    const [blockNumber, chainId] = await Promise.all([
      rpcClient.getBlockNumber(),
      rpcClient.getChainId(),
    ]);

    expect(blockNumber).toBe(42n);
    expect(chainId).toBe(42);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toHaveLength(2);
  });

  it("reads a live LP snapshot by NFT id and attaches smart alert defaults", async () => {
    const weth = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
    const usdg = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
    const pool = "0x52e65b17fb6e5ba00ed806f37afcd2daa50271ca";
    const owner = "0x1cd9254318c82e88432b47c6e0b94038b52a2558";
    const readContract = vi.fn(async ({ address, functionName }: { address: string; functionName: string }) => {
      if (functionName === "ownerOf") return owner;
      if (functionName === "positions") return [
        0n, "0x0000000000000000000000000000000000000000", weth, usdg,
        100, -199_097, -197_771, 10_243_185_685_115_262n, 0n, 0n, 0n, 0n,
      ] as const;
      if (functionName === "symbol") return address.toLowerCase() === weth.toLowerCase() ? "WETH" : "USDG";
      if (functionName === "decimals") return address.toLowerCase() === weth.toLowerCase() ? 18 : 6;
      if (functionName === "getPool") return pool;
      if (functionName === "slot0") return [
        3_882_867_619_828_751_123_875_247n, -198_481, 2_210, 2_500, 2_500, 68, true,
      ] as const;
      if (functionName === "feeGrowthGlobal0X128" || functionName === "feeGrowthGlobal1X128") return 0n;
      if (functionName === "ticks") return [0n, 0n, 0n, 0n, 0n, 0n, 0, true] as const;
      throw new Error(`unexpected ${functionName}`);
    });
    const reader = {
      readContract,
      getBlockNumber: vi.fn(async () => 53_376_560n),
      getBlock: vi.fn(async () => ({ timestamp: 1_788_434_337n })),
    };

    const position = await readRobinhoodV3Position(984_513n, reader);

    expect(position).toMatchObject({
      chainId: 4663,
      protocol: "Uniswap v3",
      tokenId: "984513",
      owner,
      pool,
      symbol0: "WETH",
      symbol1: "USDG",
      fee: 100,
      tickLower: -199_097,
      currentTick: -198_481,
      tickUpper: -197_771,
      liquidity: "10243185685115262",
      status: "in-range",
      blockNumber: "53376560",
    });
    expect(position.currentPrice).toBeCloseTo(2401.850661, 6);
    expect(position.alertRecommendation.alertLower).toBeCloseTo(2295.981511, 6);
    expect(position.alertRecommendation.alertUpper).toBeCloseTo(2535.917377, 6);
    expect(position.explorerUrl).toBe(
      `${ROBINHOOD_UNISWAP_V3.explorerUrl}/token/${ROBINHOOD_UNISWAP_V3.positionManager}/instance/984513`,
    );
  });

  it("rejects invalid NFT ids before calling the RPC", async () => {
    const reader = {
      readContract: vi.fn(),
      getBlockNumber: vi.fn(),
      getBlock: vi.fn(),
    };

    await expect(readRobinhoodV3Position(0n, reader)).rejects.toThrow("NFT ID");
    expect(reader.readContract).not.toHaveBeenCalled();
  });

  it("includes fees accrued since the position was last updated", async () => {
    const q128 = 2n ** 128n;
    const token0 = "0x0000000000000000000000000000000000000001";
    const token1 = "0x0000000000000000000000000000000000000002";
    const pool = "0x0000000000000000000000000000000000000003";
    const readContract = vi.fn(async ({ address, functionName, args, blockNumber }: { address: string; functionName: string; args?: readonly unknown[]; blockNumber?: bigint }) => {
      if (functionName === "ownerOf") return "0x0000000000000000000000000000000000000004";
      if (functionName === "positions") return [
        0n, "0x0000000000000000000000000000000000000000", token0, token1,
        100, -10, 10, 10n, q128, 2n * q128, 3n, 4n,
      ] as const;
      if (functionName === "symbol") return address === token0 ? "AAA" : "BBB";
      if (functionName === "decimals") return 0;
      if (functionName === "getPool") return pool;
      if (functionName === "slot0") {
        const multiplier = blockNumber === 10n ? 2n : blockNumber === 20n ? 3n : blockNumber === 21n ? 4n : 1n;
        return [multiplier * 2n ** 96n, 0, 0, 0, 0, 0, true] as const;
      }
      if (functionName === "feeGrowthGlobal0X128") return 10n * q128;
      if (functionName === "feeGrowthGlobal1X128") return 20n * q128;
      if (functionName === "ticks" && args?.[0] === -10) return [0n, 0n, 2n * q128, 3n * q128, 0n, 0n, 0, true] as const;
      if (functionName === "ticks" && args?.[0] === 10) return [0n, 0n, q128, 2n * q128, 0n, 0n, 0, true] as const;
      throw new Error(`unexpected ${functionName}`);
    });
    const reader = {
      readContract,
      getBlockNumber: vi.fn(async () => 100n),
      getBlock: vi.fn(async () => ({ timestamp: 1_788_434_337n })),
    };

    const position = await readRobinhoodV3Position(1n, reader);

    expect(position.tokensOwed0).toBe("63");
    expect(position.tokensOwed1).toBe("134");
    expect(position.formattedOwed0).toBe("63");
    expect(position.formattedOwed1).toBe("134");
  });

  it("reconstructs deposited, removed, collected and fee amounts from NFT lifecycle events", async () => {
    const token0 = "0x0000000000000000000000000000000000000001";
    const token1 = "0x0000000000000000000000000000000000000002";
    const pool = "0x0000000000000000000000000000000000000003";
    const readContract = vi.fn(async ({ address, functionName, args, blockNumber }: { address: string; functionName: string; args?: readonly unknown[]; blockNumber?: bigint }) => {
      if (functionName === "ownerOf") return "0x0000000000000000000000000000000000000004";
      if (functionName === "positions") return [
        0n, "0x0000000000000000000000000000000000000000", token0, token1,
        3_000, -180, 180, 100n, 0n, 0n, 3n, 4n,
      ] as const;
      if (functionName === "symbol") return address === token0 ? "AAA" : "BBB";
      if (functionName === "decimals") return 0;
      if (functionName === "getPool") return pool;
      if (functionName === "slot0") {
        const multiplier = blockNumber === 10n ? 2n : blockNumber === 20n ? 3n : blockNumber === 21n ? 4n : 1n;
        return [multiplier * 2n ** 96n, 0, 0, 0, 0, 0, true] as const;
      }
      if (functionName === "feeGrowthGlobal0X128" || functionName === "feeGrowthGlobal1X128") return 0n;
      if (functionName === "ticks" && (args?.[0] === -180 || args?.[0] === 180)) return [0n, 0n, 0n, 0n, 0n, 0n, 0, true] as const;
      throw new Error(`unexpected ${functionName}`);
    });
    const getLogs = vi.fn(async ({ event, fromBlock }: { event: { name: string }; fromBlock: bigint }) => {
      if (event.name === "IncreaseLiquidity") return [{
        blockNumber: 10n, logIndex: 0, transactionHash: `0x${"1".repeat(64)}`,
        args: { tokenId: 9n, amount0: 100n, amount1: 100n },
      }];
      if (event.name === "DecreaseLiquidity") return [{
        blockNumber: 20n, logIndex: 0, transactionHash: `0x${"2".repeat(64)}`,
        args: { tokenId: 9n, amount0: 20n, amount1: 10n },
      }];
      if (event.name === "Collect") return [{
        blockNumber: 21n, logIndex: 0, transactionHash: `0x${"3".repeat(64)}`,
        args: { tokenId: 9n, amount0: 25n, amount1: 13n },
      }];
      if (event.name === "Swap") {
        const multiplier = fromBlock === 10n ? 2n : fromBlock === 20n ? 3n : 4n;
        return [{ blockNumber: fromBlock, logIndex: 0, args: { sqrtPriceX96: multiplier * 2n ** 96n } }];
      }
      return [];
    });
    const reader = {
      readContract,
      getLogs,
      getBlockNumber: vi.fn(async () => 100n),
      getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: blockNumber === 10n ? 1_000n : 173_800n })),
      getTransactionReceipt: vi.fn(async () => ({ gasUsed: 21_000n, effectiveGasPrice: 1_000_000_000n })),
    };

    const position = await readRobinhoodV3Position(9n, reader);

    expect(position.lifecycle).toEqual({
      createdAt: "1970-01-01T00:16:40.000Z",
      ageSeconds: 172_800,
      eventCount: 3,
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
      gasSpentNative: 0.000063,
      nativeSymbol: "ETH",
    });
    expect(getLogs).toHaveBeenCalledTimes(6);
  });
});
