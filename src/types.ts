export type RangeStatus = "below" | "in-range" | "above";
export type { LpSourceId } from "../server/domain/live-lp";
import type { LpSourceId } from "../server/domain/live-lp";

export interface OnchainAmount {
  symbol: string;
  amount: number;
  valueQuote: number;
}

export interface FeeApr1h {
  annualizedPercent: number;
  feesEarnedQuote: number;
  windowSeconds: number;
  sampleCount: number;
  fullWindow: boolean;
}

export interface OnchainFeeSample {
  blockNumber: string;
  updatedAt: string;
  currentPrice: number;
  principalValueQuote: number;
  feeAmount0: number;
  feeAmount1: number;
}

export interface OnchainMarketSnapshot {
  networkName: string;
  protocol: string;
  pool: `0x${string}`;
  feeTierPercent: number;
  liquidity: string;
  tickLower: number;
  currentTick: number;
  tickUpper: number;
  status: "below" | "in-range" | "above";
}

export interface OnchainPositionAnalytics {
  createdAt: string;
  ageSeconds: number;
  eventCount: number;
  deposited: [OnchainAmount, OnchainAmount];
  withdrawn: [OnchainAmount, OnchainAmount];
  collected: [OnchainAmount, OnchainAmount];
  lifetimeFees: [OnchainAmount, OnchainAmount];
  depositedValueQuote: number;
  withdrawnValueQuote: number;
  collectedValueQuote: number;
  lifetimeFeesValueQuote: number;
  averageDailyFeesQuote: number;
  holdValueQuote: number;
  divergencePnlQuote: number;
  poolPnlQuote: number;
  roiPercent?: number;
  lifetimeFeeAprPercent?: number;
  pendingRemovedValueQuote: number;
  gasSpentNative?: number;
  nativeSymbol: string;
}

export interface OnchainPositionSnapshot {
  assets: [OnchainAmount, OnchainAmount];
  unclaimedFees: [OnchainAmount, OnchainAmount];
  principalValueQuote: number;
  unclaimedFeesValueQuote: number;
  totalValueQuote: number;
  blockNumber: string;
  updatedAt: string;
  feeApr1h?: FeeApr1h;
  market?: OnchainMarketSnapshot;
  analytics?: OnchainPositionAnalytics;
  analyticsUnavailableReason?: string;
}

export interface PositionInput {
  name: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  lowerPrice: number;
  upperPrice: number;
  entryPrice: number;
  capitalQuote: number;
  feeTier: number;
  alertLower: number;
  alertUpper: number;
  source?: {
    type: LpSourceId;
    chainId: 4663 | 56 | 8453 | 1 | 42161 | 10;
    tokenId: string;
    positionManager?: `0x${string}`;
    pool?: `0x${string}`;
    owner?: `0x${string}`;
  };
  chainSnapshot?: OnchainPositionSnapshot;
  chainHistory?: OnchainFeeSample[];
}

export interface TokenCandidate {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  price: number;
}

export interface Position extends PositionInput {
  id: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  alertState: { armed: boolean; zone: "safe" | "lower" | "upper" };
  currentPrice?: number;
  priceUpdatedAt?: string;
  priceReadFailed?: boolean;
  simulation?: {
    baseAmount: number;
    quoteAmount: number;
    valueQuote: number;
    status: RangeStatus;
    progress: number;
  };
  lastAlertAt?: string;
  lastError?: string;
}

export interface Settings {
  pollIntervalSeconds: number;
  dingEnabled: boolean;
  dingCallEnabled: boolean;
  dingRobotCode: string;
}

export interface AppState {
  positions: Position[];
  settings: Settings;
  dws: { authenticated: boolean; userId?: string; userName?: string; corpName?: string; error?: string };
  serverTime: string;
}

export interface WalletPosition {
  tokenId: string; owner: `0x${string}`; token0: `0x${string}`; token1: `0x${string}`;
  symbol0: string; symbol1: string; decimals0: number; decimals1: number; fee: number;
  tickLower: number; tickUpper: number; liquidity: string; tokensOwed0: string; tokensOwed1: string;
  formattedOwed0: string; formattedOwed1: string; currentTick?: number; currentPrice?: number;
  lowerPrice: number; upperPrice: number; status: "below" | "in-range" | "above" | "unknown"; updatedAt: string;
}

export interface WalletPositionsResponse {
  address: `0x${string}`; chainId: 56; protocol: string; positionManager: `0x${string}`;
  discovery: "manual" | "bscscan" | "manual-required"; positions: WalletPosition[]; updatedAt: string;
}

export interface LiveLpPosition {
  sourceId: LpSourceId;
  networkName: "Robinhood Chain" | "BNB Chain" | "Base" | "Ethereum" | "Arbitrum" | "Optimism";
  tokenId: string;
  chainId: 4663 | 56 | 8453 | 1 | 42161 | 10;
  protocol: "Uniswap v3" | "PancakeSwap V3";
  positionManager: `0x${string}`;
  owner: `0x${string}`;
  pool: `0x${string}`;
  token0: `0x${string}`;
  token1: `0x${string}`;
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
  explorerUrl: string;
  alertRecommendation?: {
    alertLower: number;
    alertUpper: number;
    warningLowerTick: number;
    warningUpperTick: number;
    bufferRatio: number;
    confirmations: number;
    pollIntervalSeconds: number;
    cooldownSeconds: number;
  };
  lifecycle?: {
    createdAt: string; ageSeconds: number; eventCount: number;
    deposited0: number; deposited1: number; withdrawn0: number; withdrawn1: number;
    collected0: number; collected1: number; claimedFees0: number; claimedFees1: number;
    unclaimedFees0: number; unclaimedFees1: number; totalFees0: number; totalFees1: number;
    pendingRemoved0: number; pendingRemoved1: number;
    depositedValueQuote: number; withdrawnValueQuote: number; collectedValueQuote: number; claimedFeesValueQuote: number;
    gasSpentNative?: number; nativeSymbol: string;
  };
  lifecycleUnavailableReason?: string;
}

export interface LpNftProbe {
  sourceId: LpSourceId;
  networkName: LiveLpPosition["networkName"];
  protocol: LiveLpPosition["protocol"];
  status: "matched" | "not-found" | "unavailable";
  message?: string;
}

export interface LpNftLookupResponse {
  tokenId: string;
  matches: LiveLpPosition[];
  probes: LpNftProbe[];
}
