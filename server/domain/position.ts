import type { AlertState } from "./alert-engine.js";
import type { SimulatedPosition } from "./lp-math.js";

interface LivePositionSourceBase {
  tokenId: string;
  positionManager?: `0x${string}`;
  pool?: `0x${string}`;
  owner?: `0x${string}`;
}

export type LivePositionSource = LivePositionSourceBase & ({
  type: "robinhood-uniswap-v3";
  chainId: 4663;
} | {
  type: "bsc-pancake-v3";
  chainId: 56;
} | {
  type: "base-uniswap-v3";
  chainId: 8453;
} | {
  type: "ethereum-uniswap-v3";
  chainId: 1;
} | {
  type: "arbitrum-uniswap-v3";
  chainId: 42161;
} | {
  type: "optimism-uniswap-v3";
  chainId: 10;
});

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
  source?: LivePositionSource;
  chainSnapshot?: OnchainPositionSnapshot;
  chainHistory?: OnchainFeeSample[];
}

export interface Position extends PositionInput {
  id: string;
  symbol: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  alertState: AlertState;
  currentPrice?: number;
  priceUpdatedAt?: string;
  priceReadFailed?: boolean;
  simulation?: SimulatedPosition;
  lastAlertAt?: string;
  lastError?: string;
}

function finitePositive(value: number) {
  return Number.isFinite(value) && value > 0;
}

export function readPositionEnabledUpdate(input: unknown): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("LP 不支持编辑，仅可暂停或恢复监控");
  }
  const record = input as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.enabled !== "boolean") {
    throw new Error("LP 不支持编辑，仅可暂停或恢复监控");
  }
  return record.enabled;
}

export function readPositionAlertUpdate(input: unknown, position: Position): Pick<Position, "alertLower" | "alertUpper"> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("仅支持调整上下预警线");
  }
  const record = input as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || typeof record.alertLower !== "number" || typeof record.alertUpper !== "number") {
    throw new Error("仅支持调整上下预警线");
  }
  const alertLower = record.alertLower;
  const alertUpper = record.alertUpper;
  if (!finitePositive(alertLower) || !finitePositive(alertUpper)
    || alertLower < position.lowerPrice || alertUpper > position.upperPrice || alertLower >= alertUpper) {
    throw new Error("预警值必须位于 LP 区间内");
  }
  return { alertLower, alertUpper };
}

export function createPosition(
  input: PositionInput,
  id: string = crypto.randomUUID(),
  now = new Date().toISOString(),
): Position {
  const values = [input.lowerPrice, input.upperPrice, input.entryPrice, input.capitalQuote, input.alertLower, input.alertUpper];
  if (!values.every(finitePositive)) throw new Error("价格和模拟投入必须大于 0");
  if (input.lowerPrice >= input.upperPrice) throw new Error("LP 区间下限必须小于上限");
  if (input.entryPrice < input.lowerPrice || input.entryPrice > input.upperPrice) {
    throw new Error("建仓价格必须位于 LP 区间内");
  }
  if (input.alertLower < input.lowerPrice || input.alertUpper > input.upperPrice || input.alertLower >= input.alertUpper) {
    throw new Error("预警值必须位于 LP 区间内");
  }

  const symbol = input.symbol.replace(/[^a-z0-9]/gi, "").toUpperCase();
  if (!symbol || symbol.length < 5) throw new Error("请输入有效的 Binance 交易对");

  return {
    ...input,
    id,
    symbol,
    name: input.name.trim() || symbol,
    baseAsset: input.baseAsset.trim().toUpperCase(),
    quoteAsset: input.quoteAsset.trim().toUpperCase(),
    enabled: true,
    createdAt: now,
    updatedAt: now,
    alertState: { armed: true, zone: "safe" },
  };
}
