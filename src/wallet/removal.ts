export interface RemovalRequest {
  account: string;
  owner: string;
  liquidity: bigint;
  percent: number;
  slippageBps: number;
}

export function validateRemovalRequest(input: RemovalRequest) {
  if (input.account.toLowerCase() !== input.owner.toLowerCase()) throw new Error("该仓位不属于当前钱包");
  if (!Number.isInteger(input.percent) || input.percent < 1 || input.percent > 100) throw new Error("移除比例必须在 1—100% 之间");
  if (input.liquidity <= 0n) throw new Error("该仓位没有可移除的流动性");
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 0 || input.slippageBps >= 10_000) throw new Error("滑点设置无效");
  const liquidityToRemove = input.liquidity * BigInt(input.percent) / 100n;
  if (liquidityToRemove <= 0n) throw new Error("移除后的流动性不能为零");
  return { liquidityToRemove, slippageBps: input.slippageBps };
}
