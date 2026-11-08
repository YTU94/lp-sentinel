import type { Address } from "viem";
import type { SmartAlertRecommendation } from "./smart-alerts.js";

export type LpSourceId = "robinhood-uniswap-v3" | "bsc-pancake-v3" | "base-uniswap-v3"
  | "ethereum-uniswap-v3" | "arbitrum-uniswap-v3" | "optimism-uniswap-v3";

export interface LiveLpLifecycle {
  createdAt: string;
  ageSeconds: number;
  eventCount: number;
  deposited0: number;
  deposited1: number;
  withdrawn0: number;
  withdrawn1: number;
  collected0: number;
  collected1: number;
  claimedFees0: number;
  claimedFees1: number;
  unclaimedFees0: number;
  unclaimedFees1: number;
  totalFees0: number;
  totalFees1: number;
  pendingRemoved0: number;
  pendingRemoved1: number;
  depositedValueQuote: number;
  withdrawnValueQuote: number;
  collectedValueQuote: number;
  claimedFeesValueQuote: number;
  gasSpentNative?: number;
  nativeSymbol: string;
}

export interface LiveLpPosition {
  sourceId: LpSourceId;
  networkName: "Robinhood Chain" | "BNB Chain" | "Base" | "Ethereum" | "Arbitrum" | "Optimism";
  tokenId: string;
  chainId: 4663 | 56 | 8453 | 1 | 42161 | 10;
  protocol: "Uniswap v3" | "PancakeSwap V3";
  positionManager: Address;
  owner: Address;
  pool: Address;
  token0: Address;
  token1: Address;
  symbol0: string;
  symbol1: string;
  decimals0: number;
  decimals1: number;
  fee: number;
  tickSpacing: number;
  tickLower: number;
  currentTick: number;
  tickUpper: number;
  liquidity: string;
  tokensOwed0: string;
  tokensOwed1: string;
  formattedOwed0: string;
  formattedOwed1: string;
  amount0: number;
  amount1: number;
  positionValueQuote: number;
  currentPrice: number;
  lowerPrice: number;
  upperPrice: number;
  status: "below" | "in-range" | "above";
  blockNumber: string;
  updatedAt: string;
  alertRecommendation?: SmartAlertRecommendation;
  explorerUrl: string;
  lifecycle?: LiveLpLifecycle;
  lifecycleUnavailableReason?: string;
}
