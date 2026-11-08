import { describe, expect, it } from "vitest";
import { validateRemovalRequest } from "../src/wallet/removal.js";

describe("real LP removal request", () => {
  it("requires the connected wallet to own the position", () => {
    expect(() => validateRemovalRequest({
      account: "0x1111111111111111111111111111111111111111",
      owner: "0x2222222222222222222222222222222222222222",
      liquidity: 10n,
      percent: 100,
      slippageBps: 50,
    })).toThrow("不属于当前钱包");
  });

  it("returns proportional liquidity for a partial withdrawal", () => {
    expect(validateRemovalRequest({
      account: "0x1111111111111111111111111111111111111111",
      owner: "0x1111111111111111111111111111111111111111",
      liquidity: 101n,
      percent: 50,
      slippageBps: 50,
    })).toEqual({ liquidityToRemove: 50n, slippageBps: 50 });
  });

  it("prevents an empty or out-of-range removal", () => {
    const base = {
      account: "0x1111111111111111111111111111111111111111",
      owner: "0x1111111111111111111111111111111111111111",
      liquidity: 100n,
      slippageBps: 50,
    };
    expect(() => validateRemovalRequest({ ...base, percent: 0 })).toThrow("比例");
    expect(() => validateRemovalRequest({ ...base, percent: 101 })).toThrow("比例");
    expect(() => validateRemovalRequest({ ...base, liquidity: 0n, percent: 100 })).toThrow("流动性");
  });
});
