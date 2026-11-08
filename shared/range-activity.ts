export const rangeActivityStates = ["in-range", "out-of-range", "unknown", "inactive", "future"] as const;
export type RangeActivityState = typeof rangeActivityStates[number];
export interface RangeActivitySpan {
  fromSecond: number;
  toSecond: number;
  state: RangeActivityState;
  basis?: "events";
}

export interface RangeActivityDay {
  date: string;
  seconds: Record<RangeActivityState, number>;
  inRangePercent: number | null;
  eventSeconds?: number;
  coveragePercent?: number;
  income?: {
    annualizedPercent: number;
    feesUsd: number;
    rewardsUsd: number;
    averagePrincipalUsd: number;
    sampledSeconds: number;
  };
  segments: RangeActivitySpan[];
}

export interface LpRangeActivity {
  version: 1;
  positionKey: string;
  source: "revert" | "revert+onchain";
  timezone: "Asia/Shanghai";
  method: "snapshot-step" | "snapshot-and-events";
  maxGapSeconds: number;
  fetchedAt: string;
  expiresAt: string;
  createdAt?: string;
  sampleCount: number;
  downsampled: boolean;
  days: RangeActivityDay[];
  warnings: string[];
  replay?: {
    status: "complete" | "partial" | "unavailable";
    filledSeconds: number;
    eventCount: number;
    completedRanges: number;
    attemptedRanges: number;
    throughBlock?: string;
    throughAt?: string;
  };
}
