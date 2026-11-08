import { describe, expect, it, vi } from "vitest";
import { readBaseV3Position } from "../server/services/base-v3.js";

describe("Base Uniswap v3 position lookup", () => {
  it("reads a Base V3 NFT with the canonical deployment and BaseScan link", async () => {
    const weth = "0x4200000000000000000000000000000000000006";
    const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    const pool = "0x0000000000000000000000000000000000000003";
    const owner = "0x0000000000000000000000000000000000000004";
    const readContract = vi.fn(async ({ address, functionName }: { address: string; functionName: string }) => {
      if (functionName === "ownerOf") return owner;
      if (functionName === "positions") return [
        0n, "0x0000000000000000000000000000000000000000", weth, usdc,
        500, -199_100, -197_700, 10_000_000_000_000_000n, 0n, 0n, 0n, 0n,
      ] as const;
      if (functionName === "symbol") return address.toLowerCase() === weth.toLowerCase() ? "WETH" : "USDC";
      if (functionName === "decimals") return address.toLowerCase() === weth.toLowerCase() ? 18 : 6;
      if (functionName === "getPool") return pool;
      if (functionName === "slot0") return [3_961_408_125_713_216_879_677_197n, -198_070, 0, 0, 0, 0, true] as const;
      if (functionName === "feeGrowthGlobal0X128" || functionName === "feeGrowthGlobal1X128") return 0n;
      if (functionName === "ticks") return [0n, 0n, 0n, 0n, 0n, 0n, 0, true] as const;
      throw new Error(`unexpected ${functionName}`);
    });

    const position = await readBaseV3Position(123_456n, {
      readContract,
      getBlockNumber: vi.fn(async () => 35_000_000n),
      getBlock: vi.fn(async () => ({ timestamp: 1_788_700_000n })),
    });

    expect(position).toMatchObject({
      sourceId: "base-uniswap-v3",
      networkName: "Base",
      tokenId: "123456",
      chainId: 8453,
      protocol: "Uniswap v3",
      positionManager: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1",
      owner,
      pool,
      symbol0: "WETH",
      symbol1: "USDC",
      fee: 500,
      status: "in-range",
    });
    expect(position.currentPrice).toBeCloseTo(2_500, 6);
    expect(position.explorerUrl).toBe("https://basescan.org/token/0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1?a=123456");
  });
});
