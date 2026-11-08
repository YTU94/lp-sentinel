import { describe, expect, it, vi } from "vitest";
import { PANCAKE_V3_POSITION_MANAGER, readPancakeV3Position } from "../server/services/pancake-v3.js";

describe("BNB Chain PancakeSwap V3 NFT lookup", () => {
  it("normalizes a PancakeSwap NFT into the common live LP model", async () => {
    const token0 = "0x0000000000000000000000000000000000000001";
    const token1 = "0x0000000000000000000000000000000000000002";
    const pool = "0x0000000000000000000000000000000000000003";
    const owner = "0x0000000000000000000000000000000000000004";
    const readContract = vi.fn(async ({ address, functionName, args }: { address: string; functionName: string; args?: readonly unknown[] }) => {
      if (functionName === "ownerOf") return owner;
      if (functionName === "positions") return [0n, "0x0000000000000000000000000000000000000000", token0, token1, 2_500, -100, 100, 1_000_000_000_000_000_000n, 0n, 0n, 0n, 0n] as const;
      if (functionName === "symbol") return address === token0 ? "WBNB" : "SPCXB";
      if (functionName === "decimals") return 18;
      if (functionName === "getPool") return pool;
      if (functionName === "slot0") return [2n ** 96n, 0, 0, 0, 0, 0, true] as const;
      if (functionName === "feeGrowthGlobal0X128" || functionName === "feeGrowthGlobal1X128") return 0n;
      if (functionName === "ticks" && (args?.[0] === -100 || args?.[0] === 100)) return [0n, 0n, 0n, 0n, 0n, 0n, 0, true] as const;
      throw new Error(`unexpected ${functionName}`);
    });
    const reader = {
      readContract,
      getBlockNumber: vi.fn(async () => 50_000_000n),
      getBlock: vi.fn(async () => ({ timestamp: 1_788_434_337n })),
    };

    const position = await readPancakeV3Position(7_314_935n, reader);

    expect(position).toMatchObject({
      sourceId: "bsc-pancake-v3",
      networkName: "BNB Chain",
      chainId: 56,
      protocol: "PancakeSwap V3",
      positionManager: PANCAKE_V3_POSITION_MANAGER,
      tokenId: "7314935",
      owner,
      symbol0: "WBNB",
      symbol1: "SPCXB",
      fee: 2_500,
      tickSpacing: 50,
      status: "in-range",
      blockNumber: "50000000",
    });
    expect(position.currentPrice).toBe(1);
    expect(position.positionValueQuote).toBeGreaterThan(0);
  });
});
