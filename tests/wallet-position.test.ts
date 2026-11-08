import { describe, expect, it } from "vitest";
import { calculateMinimumAmount, normalizeIndexedTokenIds } from "../server/domain/wallet-position.js";

describe("wallet LP safety helpers", () => {
  it("deduplicates indexed NFT transfers and keeps only tokens still owned by the wallet", () => {
    const wallet = "0x1111111111111111111111111111111111111111";
    const transfers = [
      { tokenID: "7", to: wallet },
      { tokenID: "7", to: "0x2222222222222222222222222222222222222222" },
      { tokenID: "9", to: wallet.toUpperCase() },
      { tokenID: "7", to: wallet },
    ];

    expect(normalizeIndexedTokenIds(transfers, wallet)).toEqual([7n, 9n]);
  });

  it("applies the selected slippage without rounding the minimum upward", () => {
    expect(calculateMinimumAmount(1_000_001n, 50)).toBe(995_000n);
  });

  it("rejects unsafe slippage values", () => {
    expect(() => calculateMinimumAmount(100n, -1)).toThrow("滑点");
    expect(() => calculateMinimumAmount(100n, 10_000)).toThrow("滑点");
  });
});
