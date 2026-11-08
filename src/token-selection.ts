import type { PositionInput, TokenCandidate } from "./types";

export function formatTokenPrice(price: number): string {
  return new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: price >= 1 ? 2 : 0,
    maximumFractionDigits: price >= 1 ? 2 : 6,
  }).format(price);
}

export function applyTokenCandidate(form: PositionInput, candidate: TokenCandidate): PositionInput {
  const lowerPrice = candidate.price * 0.8;
  const upperPrice = candidate.price * 1.2;
  return {
    ...form,
    symbol: candidate.symbol,
    baseAsset: candidate.baseAsset,
    quoteAsset: candidate.quoteAsset,
    entryPrice: candidate.price,
    lowerPrice,
    upperPrice,
    alertLower: candidate.price * 0.84,
    alertUpper: candidate.price * 1.16,
  };
}
