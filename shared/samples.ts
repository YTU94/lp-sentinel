import type { PortfolioHistory, PortfolioPosition } from "./portfolio.js";
import type { UniswapPoolUniverse } from "./pool-universe.js";
import type { LpRangeActivity, RangeActivityDay } from "./range-activity.js";

export type SampleHistory = Omit<PortfolioHistory, "rangeActivity"> & {
  rangeActivity?: Omit<LpRangeActivity, "days"> & { days: Omit<RangeActivityDay, "segments">[] };
};

export interface WalletSample {
  position: Pick<PortfolioPosition, "key" | "sourceId" | "network" | "tokenId" | "token0" | "token1" | "status" | "currentPrice" | "lowerPrice" | "upperPrice" | "updatedAt" | "dataStale">;
  history: SampleHistory;
}

export interface SampleSnapshot {
  mode: "wallet" | "top50";
  wallet?: string;
  capturedAt: string;
  positions: WalletSample[];
  universe?: UniswapPoolUniverse;
  fallbackReason?: string;
  warnings: string[];
}

export interface SampleState {
  wallet?: string;
  walletQueriedAt?: number;
  lastAttemptAt?: string;
  processing?: boolean;
  nextUpdateAt?: string;
  error?: string;
  snapshot?: SampleSnapshot;
  previousWalletSnapshot?: SampleSnapshot;
}

export interface SampleView extends SampleState {
  updating: boolean;
}
