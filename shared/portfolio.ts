import type { UniswapMarketContext } from "./pool-universe.js";
import type { LpRangeActivity } from "./range-activity.js";

export const portfolioSources = [
  { id: "robinhood-uniswap-v3", chainId: 4663, network: "Robinhood Chain", protocol: "Uniswap V3" },
  { id: "base-uniswap-v3", chainId: 8453, network: "Base", protocol: "Uniswap V3" },
  { id: "ethereum-uniswap-v3", chainId: 1, network: "Ethereum", protocol: "Uniswap V3" },
  { id: "arbitrum-uniswap-v3", chainId: 42161, network: "Arbitrum", protocol: "Uniswap V3" },
  { id: "optimism-uniswap-v3", chainId: 10, network: "Optimism", protocol: "Uniswap V3" },
  { id: "bsc-pancake-v3", chainId: 56, network: "BNB Chain", protocol: "PancakeSwap V3" },
  { id: "base-aerodrome", chainId: 8453, network: "Base", protocol: "Aerodrome" },
] as const;

export type PortfolioSourceId = typeof portfolioSources[number]["id"];
export type PortfolioSource = typeof portfolioSources[number];
export type PortfolioToken = {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  amount: number;
  stock?: { issuer: string; name: string; multiplier: string; status: string };
};

export interface PortfolioPerformance {
  benchmark: "HOLD";
  currency: "USD";
  principalUsd?: number;
  totalPnlUsd?: number;
  poolPnlUsd?: number;
  divergenceUsd?: number;
  totalAprPercent?: number;
  feeAprPercent?: number;
  feeAprExperimental?: boolean;
  roiPercent?: number;
  totalFeesUsd?: number;
  uncollectedFeesUsd?: number;
  rewardsUsd?: number;
  unclaimedRewardsUsd?: number;
  ageDays?: number;
}

export interface PortfolioCashFlows {
  eventCount: number;
  firstAt?: string;
  lastAt?: string;
  gasPaidUsd?: number;
  truncated: boolean;
  events: { at: string; type: string; amount0?: number; amount1?: number; amount?: number; valueUsd?: number }[];
}

export interface PortfolioHistory {
  lookbackDays: number;
  fetchedAt: string;
  market?: UniswapMarketContext;
  rangeActivity?: LpRangeActivity;
  position: {
    status: "ready" | "partial" | "unavailable";
    sampleCount: number;
    sourceSampleCount: number;
    from?: string;
    to?: string;
    coveredDays: number;
    downsampled: boolean;
    maxGapHours?: number;
    inRangeObservationPercent?: number;
    priceMin?: number;
    priceMax?: number;
    dailyFees: { date: string; usd: number }[];
    dailyRewards: { date: string; usd: number }[];
    snapshots: { at: string; priceInToken1?: number; inRange: boolean; active?: boolean; principalUsd?: number }[];
  };
  pool: {
    status: "ready" | "partial" | "unavailable";
    sampleCount: number;
    from?: string;
    to?: string;
    feesUsd?: number;
    volumeUsd?: number;
    days: { date: string; feesUsd?: number; volumeUsd?: number; tvlUsd?: number; feeAprPercent?: number; rewardsUsd?: number }[];
  };
  warnings: string[];
}

export interface PortfolioPosition {
  key: string;
  sourceId: PortfolioSourceId;
  chainId: number;
  network: string;
  protocol: string;
  pool: `0x${string}`;
  positionManager?: `0x${string}`;
  tokenId?: string;
  kind: "concentrated" | "classic";
  staked: boolean;
  token0: PortfolioToken;
  token1: PortfolioToken;
  currentPrice?: number;
  lowerPrice?: number;
  upperPrice?: number;
  valueQuote?: number;
  feePercent?: number;
  status: "in-range" | "outside" | "full-range" | "empty";
  blockNumber?: string;
  updatedAt: string;
  explorerUrl: string;
  dataSource?: "rpc" | "revert";
  dataStale?: boolean;
  revertUrl?: string;
  performance?: PortfolioPerformance;
  cashFlows?: PortfolioCashFlows;
  history?: PortfolioHistory;
  notes: string[];
}

export interface PortfolioPage {
  sourceId: PortfolioSourceId;
  positions: PortfolioPosition[];
  scanned: number;
  total: number;
  nextCursor?: string;
  warnings: string[];
  blockNumber?: string;
}

export interface PortfolioAdvice {
  positionKey: string;
  provider: "codex" | "gateway" | "rules";
  action: "hold" | "recenter" | "reduce";
  summary: string;
  strategy?: string;
  trigger?: string;
  reasons: string[];
  risks: string[];
  nextSteps: string[];
  createdAt: string;
  snapshot: PortfolioPosition;
}

export interface PortfolioAiStatus {
  provider: "codex" | "gateway" | "unavailable";
  available: boolean;
  label: string;
}
