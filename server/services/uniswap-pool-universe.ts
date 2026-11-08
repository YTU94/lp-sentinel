import type { PortfolioPosition } from "../../shared/portfolio.js";
import { setTimeout as sleep } from "node:timers/promises";
import type { UniswapMarketContext, UniswapPoolSample, UniswapPoolUniverse, UniswapReferencePool } from "../../shared/pool-universe.js";

const API = "https://yields.llama.fi";
const DAY = 86_400_000;
const LIMIT = 50;
const LOOKBACK = 30;
const protocols = new Set(["uniswap-v2", "uniswap-v3", "uniswap-v4"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let cached: { value: UniswapPoolUniverse; expiresAt: number } | undefined;
let pending: Promise<UniswapPoolUniverse> | undefined;

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

async function readData(path: string, maxBytes: number, timeout: number, deadline: AbortSignal): Promise<unknown[]> {
  const options = {
    headers: { Accept: "application/json", "User-Agent": "LP-Sentinel/0.1 (+https://lp-sentinel.vercel.app)" },
    redirect: "error" as const, signal: AbortSignal.any([deadline, AbortSignal.timeout(timeout)]),
  };
  let response = await fetch(`${API}${path}`, options);
  if (response.status === 429 || response.status >= 500) {
    const retryAfter = Number(response.headers.get("retry-after"));
    await response.body?.cancel();
    await sleep(Math.min(5000, Math.max(1500, retryAfter * 1000 || 0)));
    response = await fetch(`${API}${path}`, { ...options, signal: AbortSignal.any([deadline, AbortSignal.timeout(timeout)]) });
  }
  if (!response.ok) throw new Error("Uniswap 样本数据源暂不可用");
  const body = await response.arrayBuffer();
  if (body.byteLength > maxBytes) throw new Error("Uniswap 样本响应超过读取上限");
  const result = JSON.parse(new TextDecoder().decode(body)) as { status?: unknown; data?: unknown };
  if (result.status !== "success" || !Array.isArray(result.data)) throw new Error("Uniswap 样本响应不完整");
  return result.data;
}

async function collectUniverse(): Promise<UniswapPoolUniverse> {
  const rankedAt = new Date().toISOString();
  const end = Math.floor(Date.now() / DAY) * DAY;
  const start = end - LOOKBACK * DAY;
  const deadline = AbortSignal.timeout(100_000);
  const catalog = await readData("/pools", 20_000_000, 25_000, deadline);
  const unique = new Map<string, UniswapReferencePool>();
  for (const value of catalog) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const tvlUsd = number(row.tvlUsd);
    if (!protocols.has(String(row.project)) || typeof row.pool !== "string" || !uuid.test(row.pool) || !tvlUsd) continue;
    if (typeof row.chain !== "string" || !row.chain || row.chain.length > 60 || typeof row.symbol !== "string" || !row.symbol || row.symbol.length > 100) continue;
    if (!Array.isArray(row.underlyingTokens) || row.underlyingTokens.length !== 2 || row.underlyingTokens.some(token => typeof token !== "string" || !/^0x[0-9a-f]{40}$/i.test(token))) continue;
    const pool: UniswapReferencePool = {
      id: row.pool.toLowerCase(), rank: 0, chain: row.chain,
      protocol: row.project as UniswapReferencePool["protocol"], pair: row.symbol,
      feeLabel: typeof row.poolMeta === "string" ? row.poolMeta.slice(0, 80) : undefined,
      underlyingTokens: row.underlyingTokens.map(token => String(token).toLowerCase()),
      tvlUsd, baseApyPercent: number(row.apyBase),
      history: { status: "unavailable", sampleCount: 0, samples: [] },
    };
    if (unique.has(pool.id)) throw new Error("Uniswap 数据源返回重复池标识，排名未接受");
    unique.set(pool.id, pool);
  }
  const pools = [...unique.values()].sort((a, b) => b.tvlUsd - a.tvlUsd || a.id.localeCompare(b.id)).slice(0, LIMIT);
  if (!pools.length) throw new Error("Uniswap 数据源未返回有效池子");
  pools.forEach((pool, index) => { pool.rank = index + 1; });
  for (let offset = 0; offset < pools.length && !deadline.aborted; offset += 2) {
    await Promise.all(pools.slice(offset, offset + 2).map(async pool => {
      try {
        const rows = await readData(`/chart/${pool.id}`, 2_000_000, 10_000, deadline);
        const days = new Map<string, UniswapPoolSample>();
        for (const value of rows) {
          if (!value || typeof value !== "object") continue;
          const row = value as Record<string, unknown>;
          const time = typeof row.timestamp === "string" ? Date.parse(row.timestamp) : NaN;
          const tvlUsd = number(row.tvlUsd);
          if (!Number.isFinite(time) || time < start || time >= end || tvlUsd === undefined) continue;
          const observedAt = new Date(time).toISOString();
          const date = observedAt.slice(0, 10);
          if (days.has(date) && days.get(date)!.observedAt >= observedAt) continue;
          days.set(date, { date, observedAt, tvlUsd, baseApyPercent: number(row.apyBase), rewardApyPercent: number(row.apyReward) });
        }
        const samples = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
        const gaps = samples.slice(1).map((sample, index) => (Date.parse(sample.date) - Date.parse(samples[index].date)) / DAY);
        pool.history = {
          status: samples.length === LOOKBACK ? "ready" : samples.length ? "partial" : "unavailable",
          sampleCount: samples.length, maxGapDays: gaps.length ? Math.max(...gaps) : undefined, samples,
        };
      } catch { /* A failed pool retains its unavailable state and its TVL rank. */ }
    }));
    if (offset + 2 < pools.length && !deadline.aborted) await sleep(300);
  }
  const daily: UniswapPoolUniverse["daily"] = [];
  for (let time = start; time < end; time += DAY) {
    const date = new Date(time).toISOString().slice(0, 10);
    const samples = pools.flatMap(pool => pool.history.samples.filter(sample => sample.date === date));
    const yields = samples.filter(sample => sample.baseApyPercent !== undefined && sample.tvlUsd > 0);
    const yieldTvl = yields.reduce((total, sample) => total + sample.tvlUsd, 0);
    daily.push({
      date, sampledPools: samples.length, yieldSampledPools: yields.length,
      tvlUsd: samples.reduce((total, sample) => total + sample.tvlUsd, 0),
      tvlWeightedBaseApyPercent: yieldTvl ? yields.reduce((total, sample) => total + sample.tvlUsd * sample.baseApyPercent!, 0) / yieldTvl : undefined,
    });
  }
  const completePools = pools.filter(pool => pool.history.status === "ready").length;
  const warnings = [
    "范围为 DeFiLlama 收录的 Uniswap V2/V3/V4 池；按当前美元 TVL 排名回溯历史，存在选择与幸存者偏差。",
    "每个完整 UTC 日保留最后一条真实观测；缺失日不补零、不插值，基础 APY 是池级估计值。",
    "池级 TVL 与 APY 不包含个人区间、无常损失、gas 和再平衡成本，不能直接视为个人收益。",
  ];
  if (pools.length < LIMIT) warnings.push(`数据源仅返回 ${pools.length} 个有效池，未补足 50 个。`);
  if (completePools < pools.length) warnings.push(`${pools.length - completePools} 个池的 30 日历史不完整，原排名保留。`);
  return {
    source: "DefiLlama", rankedAt, fetchedAt: new Date().toISOString(), requestedPools: LIMIT,
    lookbackDays: LOOKBACK, from: new Date(start).toISOString().slice(0, 10), to: new Date(end - DAY).toISOString().slice(0, 10),
    status: pools.length === LIMIT && completePools === LIMIT ? "ready" : "partial",
    pools, sampledPools: pools.filter(pool => pool.history.sampleCount > 0).length, completePools,
    sampleCount: pools.reduce((total, pool) => total + pool.history.sampleCount, 0),
    totalTvlUsd: pools.reduce((total, pool) => total + pool.tvlUsd, 0), daily, warnings,
  };
}

export function readUniswapPoolUniverse(): Promise<UniswapPoolUniverse> {
  if (cached && Date.now() < cached.expiresAt) return Promise.resolve(cached.value);
  return pending ??= collectUniverse().then(value => {
    cached = { value, expiresAt: Date.now() + (value.status === "ready" ? 3_600_000 : 300_000) };
    return value;
  }).finally(() => { pending = undefined; });
}

export function uniswapMarketContext(position: PortfolioPosition, universe: UniswapPoolUniverse): UniswapMarketContext {
  const chain = { 1: "Ethereum", 10: "Optimism", 56: "Binance", 8453: "Base", 42161: "Arbitrum", 4663: "Robinhood" }[position.chainId];
  const tokens = [position.token0.address.toLowerCase(), position.token1.address.toLowerCase()];
  const samePairReferences = universe.pools.filter(pool => pool.chain === chain && tokens.every(token => pool.underlyingTokens.includes(token)))
    .map(pool => ({ rank: pool.rank, chain: pool.chain, protocol: pool.protocol, pair: pool.pair, feeLabel: pool.feeLabel, sampleCount: pool.history.sampleCount, samples: pool.history.samples }));
  return {
    source: universe.source, rankedAt: universe.rankedAt, selection: "current-tvl-top-50", status: universe.status,
    poolCount: universe.pools.length, completePools: universe.completePools, sampleCount: universe.sampleCount,
    from: universe.from, to: universe.to, daily: universe.daily, samePairReferences, warnings: universe.warnings,
  };
}
