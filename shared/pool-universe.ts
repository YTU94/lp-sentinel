export interface UniswapPoolSample {
  date: string;
  observedAt: string;
  tvlUsd: number;
  baseApyPercent?: number;
  rewardApyPercent?: number;
}

export interface UniswapReferencePool {
  id: string;
  rank: number;
  chain: string;
  protocol: "uniswap-v2" | "uniswap-v3" | "uniswap-v4";
  pair: string;
  feeLabel?: string;
  underlyingTokens: string[];
  tvlUsd: number;
  baseApyPercent?: number;
  history: {
    status: "ready" | "partial" | "unavailable";
    sampleCount: number;
    maxGapDays?: number;
    samples: UniswapPoolSample[];
  };
}

export interface UniswapPoolUniverse {
  source: "DefiLlama";
  rankedAt: string;
  fetchedAt: string;
  requestedPools: number;
  lookbackDays: number;
  from: string;
  to: string;
  status: "ready" | "partial";
  pools: UniswapReferencePool[];
  sampledPools: number;
  completePools: number;
  sampleCount: number;
  totalTvlUsd: number;
  daily: {
    date: string;
    sampledPools: number;
    yieldSampledPools: number;
    tvlUsd: number;
    tvlWeightedBaseApyPercent?: number;
  }[];
  warnings: string[];
}

export interface UniswapMarketContext {
  source: "DefiLlama";
  rankedAt: string;
  selection: "current-tvl-top-50";
  status: UniswapPoolUniverse["status"];
  poolCount: number;
  completePools: number;
  sampleCount: number;
  from: string;
  to: string;
  daily: UniswapPoolUniverse["daily"];
  samePairReferences: {
    rank: number;
    chain: string;
    protocol: UniswapReferencePool["protocol"];
    pair: string;
    feeLabel?: string;
    sampleCount: number;
    samples: UniswapPoolSample[];
  }[];
  warnings: string[];
}
