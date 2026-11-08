export interface IndexedNftTransfer { tokenID: string; to: string }

export function normalizeIndexedTokenIds(transfers: IndexedNftTransfer[], wallet: string): bigint[] {
  const latest = new Map<string, string>();
  for (const transfer of transfers) latest.set(transfer.tokenID, transfer.to.toLowerCase());
  return [...latest.entries()]
    .filter(([, owner]) => owner === wallet.toLowerCase())
    .map(([tokenId]) => BigInt(tokenId))
    .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

export function calculateMinimumAmount(amount: bigint, slippageBps: number): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) {
    throw new Error("滑点必须是 0—9999 个基点之间的整数");
  }
  return amount * BigInt(10_000 - slippageBps) / 10_000n;
}
