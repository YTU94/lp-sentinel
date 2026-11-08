import { getAddress, isAddress, type Address } from "viem";
import { addDailyIncomeApr, calculateRangeActivity, type DailyIncomeSample } from "../domain/range-activity.js";
import { backfillRangeActivity, type RangeHistoryAnchor, type RangeHistoryMint } from "./range-activity-replay.js";
import type { PortfolioCashFlows, PortfolioHistory, PortfolioPage, PortfolioPerformance, PortfolioPosition, PortfolioSource, PortfolioToken } from "../../shared/portfolio.js";

// These are the read endpoints used by https://revert.finance, verified on 2026-11-06.
const API = "https://api.revert.finance/v1";
const networks: Record<number, { name: string; explorer: string }> = {
  1: { name: "mainnet", explorer: "https://etherscan.io" },
  10: { name: "optimism", explorer: "https://optimistic.etherscan.io" },
  56: { name: "bnb", explorer: "https://bscscan.com" },
  4663: { name: "robinhood", explorer: "https://robinhoodchain.blockscout.com" },
  8453: { name: "base", explorer: "https://basescan.org" },
  42161: { name: "arbitrum", explorer: "https://arbiscan.io" },
};
type Row = Record<string, unknown>;
type Cursor = { phase: number; scanned: number; priorTotal: number; after?: string };
type RevertPage = { rows: unknown[]; total: number; next?: string; incomplete: boolean; stale: boolean };
const cache = new Map<string, { expires: number; task: Promise<RevertPage> }>();

function record(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Revert 返回的数据格式无效");
  return value as Row;
}

function numeric(value: unknown) {
  if (typeof value !== "number" && (typeof value !== "string" || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value))) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function positive(value: unknown) {
  const number = numeric(value);
  if (number === undefined || number < 0) throw new Error("Revert 返回的数量或价格无效");
  return number;
}

function address(value: unknown): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) throw new Error("Revert 返回的合约或归属地址无效");
  return getAddress(value.toLowerCase());
}

function exchanges(source: PortfolioSource) {
  // Revert treats all four deployments as CL; its v2/v3 suffixes identify deployments.
  return source.id === "base-aerodrome" ? ["aero", "aerodrome", "aerodromev2", "aerodromev3"] : [source.id === "bsc-pancake-v3" ? "pancakeswapv3" : "uniswapv3"];
}

function decodeCursor(input: unknown, phases: number): Cursor {
  if (input === undefined || input === "") return { phase: 0, scanned: 0, priorTotal: 0 };
  try {
    if (typeof input !== "string" || input.length > 1500 || !/^r:[A-Za-z0-9_-]+$/.test(input)) throw new Error();
    const value = record(JSON.parse(Buffer.from(input.slice(2), "base64url").toString("utf8")));
    if (![value.phase, value.scanned, value.priorTotal].every(item => Number.isSafeInteger(item) && Number(item) >= 0 && Number(item) <= 10_000_000) || Number(value.phase) >= phases) throw new Error();
    if (value.after !== undefined && (typeof value.after !== "string" || !value.after || value.after.length > 512 || /[\u0000-\u001f\u007f]/.test(value.after))) throw new Error();
    return { phase: Number(value.phase), scanned: Number(value.scanned), priorTotal: Number(value.priorTotal), after: value.after as string | undefined };
  } catch { throw new Error("分页参数无效，请重新查询地址"); }
}

function encodeCursor(value: Cursor) {
  return `r:${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
}

async function fetchPage(url: URL): Promise<RevertPage> {
  let response: Response;
  try { response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(25_000) }); }
  catch { throw new Error("Revert 查仓服务连接失败，请稍后重试"); }
  if (!response.ok) throw new Error(`Revert 查仓服务暂不可用（HTTP ${response.status}）`);
  const text = await response.text();
  if (text.length > 8_000_000) throw new Error("Revert 返回的数据超过单页限制");
  const body = record(JSON.parse(text));
  const pagination = record(body.pagination);
  const total = numeric(pagination.total_count);
  if (body.success !== true || !Array.isArray(body.data) || body.data.length > 100 || total === undefined || !Number.isSafeInteger(total) || total < 0 || total > 10_000_000 || typeof pagination.has_next !== "boolean" || !Array.isArray(body.incomplete) || !Array.isArray(body.stale)) throw new Error("Revert 查仓响应不完整，请稍后重试");
  const next = pagination.has_next ? pagination.next_cursor : undefined;
  if (pagination.has_next && (typeof next !== "string" || !next || next.length > 512 || /[\u0000-\u001f\u007f]/.test(next))) throw new Error("Revert 分页信息无效");
  return { rows: body.data, total, next: next as string | undefined, incomplete: body.incomplete.length > 0, stale: body.stale.length > 0 };
}

async function pageRequest(url: URL, fresh: boolean) {
  const key = url.toString();
  if (fresh) return fetchPage(url);
  for (const [id, item] of cache) if (item.expires <= Date.now()) cache.delete(id);
  const existing = cache.get(key);
  if (existing) return existing.task;
  const entry = { expires: Date.now() + 15_000, task: fetchPage(url) };
  cache.set(key, entry);
  while (cache.size > 256) cache.delete(cache.keys().next().value!);
  try { return await entry.task; }
  catch (error) { if (cache.get(key) === entry) cache.delete(key); throw error; }
}

function token(raw: Row, key: "token0" | "token1", amount: unknown): PortfolioToken {
  const contract = address(raw[key]);
  const tokens = record(raw.tokens);
  const metadata = record(tokens[contract.toLowerCase()] ?? tokens[contract]);
  const decimals = numeric(metadata.decimals);
  if (decimals === undefined || !Number.isInteger(decimals) || decimals < 0 || decimals > 36 || typeof metadata.symbol !== "string") throw new Error("Revert 代币信息无效");
  return { address: contract, symbol: metadata.symbol.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 40), decimals, amount: positive(amount) };
}

function performance(raw: Row, token0: PortfolioToken, token1: PortfolioToken, flows: Row[]): PortfolioPerformance {
  const benchmarks = raw.performance ? record(raw.performance) : {};
  const hold = benchmarks.hodl ? record(benchmarks.hodl) : {};
  const tokens = record(raw.tokens);
  const price0 = numeric(record(tokens[token0.address.toLowerCase()] ?? tokens[token0.address]).price);
  const price1 = numeric(record(tokens[token1.address.toLowerCase()] ?? tokens[token1.address]).price);
  const fees0 = numeric(raw.uncollected_fees0), fees1 = numeric(raw.uncollected_fees1);
  const pending = flows.filter(flow => flow.type === "current-reward-state" && flow.current === true);
  const rewardValues = pending.map(flow => {
    const prices = flow.prices ? record(flow.prices) : {};
    const rewardPrice = prices.reward_token ? numeric(record(prices.reward_token).usd) : undefined;
    const amount = numeric(flow.amount);
    return amount !== undefined && rewardPrice !== undefined ? amount * rewardPrice : undefined;
  });
  return {
    benchmark: "HOLD", currency: "USD", principalUsd: numeric(raw.underlying_value),
    totalPnlUsd: numeric(hold.pnl), poolPnlUsd: numeric(hold.pool_pnl), divergenceUsd: numeric(hold.il),
    totalAprPercent: numeric(hold.apr), feeAprPercent: numeric(hold.fee_apr), feeAprExperimental: Boolean(raw.fee_experiment), roiPercent: numeric(hold.roi),
    totalFeesUsd: numeric(raw.fees_value), rewardsUsd: numeric(raw.rewards_value), ageDays: numeric(raw.age),
    uncollectedFeesUsd: fees0 !== undefined && fees1 !== undefined && price0 !== undefined && price1 !== undefined ? fees0 * price0 + fees1 * price1 : undefined,
    unclaimedRewardsUsd: rewardValues.length && rewardValues.every(value => value !== undefined) ? rewardValues.reduce<number>((sum, value) => sum + value!, 0) : undefined,
  };
}

function cashFlowSummary(flows: Row[]): PortfolioCashFlows {
  const types = new Set(["deposits", "withdrawals", "claimed-fees", "reward-claim", "gas-costs", "reward-stake", "reward-unstake"]);
  const events: PortfolioCashFlows["events"] = [];
  for (const flow of flows) {
    const timestamp = numeric(flow.timestamp);
    if (flow.current === true || !types.has(String(flow.type)) || timestamp === undefined || timestamp < 1_000_000_000 || timestamp * 1000 > Date.now() + 5_000) continue;
    const explicitUsd = numeric(flow.amount_usd);
    let valueUsd = explicitUsd === undefined ? undefined : Math.abs(explicitUsd);
    const prices = flow.prices ? record(flow.prices) : {};
    const amount0 = numeric(flow.amount0), amount1 = numeric(flow.amount1), amount = numeric(flow.amount);
    if (valueUsd === undefined && amount0 !== undefined && amount1 !== undefined) {
      const price0 = prices.token0 ? numeric(record(prices.token0).usd) : undefined;
      const price1 = prices.token1 ? numeric(record(prices.token1).usd) : undefined;
      if (price0 !== undefined && price1 !== undefined) valueUsd = Math.abs(amount0 * price0 + amount1 * price1);
    }
    if (valueUsd === undefined && amount !== undefined && prices.reward_token) {
      const price = numeric(record(prices.reward_token).usd);
      if (price !== undefined) valueUsd = Math.abs(amount * price);
    }
    events.push({ at: new Date(timestamp * 1000).toISOString(), type: String(flow.type), amount0, amount1, amount, valueUsd: valueUsd !== undefined && Number.isFinite(valueUsd) ? valueUsd : undefined });
  }
  events.sort((a, b) => a.at.localeCompare(b.at));
  const gas = events.filter(event => event.type === "gas-costs");
  return {
    eventCount: events.length, firstAt: events[0]?.at, lastAt: events.at(-1)?.at,
    gasPaidUsd: gas.length && gas.every(event => event.valueUsd !== undefined) ? gas.reduce((sum, event) => sum + event.valueUsd!, 0) : undefined,
    truncated: events.length > 24, events: events.length > 24 ? [events[0], ...events.slice(-23)] : events,
  };
}

function position(rawValue: unknown, wallet: Address, source: PortfolioSource, exchange: string, stale: boolean): PortfolioPosition {
  const raw = record(rawValue);
  const network = networks[source.chainId];
  if (raw.network !== network.name || raw.exchange !== exchange || raw.exited === true || address(raw.real_owner ?? raw.owner).toLowerCase() !== wallet.toLowerCase()) throw new Error("Revert 仓位归属或来源已变化");
  const pool = address(raw.pool);
  const token0 = token(raw, "token0", raw.current_amount0), token1 = token(raw, "token1", raw.current_amount1);
  if (typeof raw.nft_id === "number" && !Number.isSafeInteger(raw.nft_id) || !/^\d{1,78}$/.test(String(raw.nft_id)) || BigInt(String(raw.nft_id)) <= 0n) throw new Error("Revert NFT 标识无效");
  const tokenId = BigInt(String(raw.nft_id)).toString();
  const currentPrice = positive(raw.pool_price);
  const lowerPrice = positive(raw.price_lower), upperPrice = positive(raw.price_upper);
  if (!currentPrice || !lowerPrice || !upperPrice || upperPrice <= lowerPrice || typeof raw.in_range !== "boolean") throw new Error("Revert 区间或池内价格无效");
  const time = positive(raw.now_ts) * 1000;
  if (!Number.isSafeInteger(time) || time < 1_000_000_000_000 || time > 8_640_000_000_000_000) throw new Error("Revert 快照时间无效");
  const flows = Array.isArray(raw.cash_flows) ? raw.cash_flows.map(record) : [];
  const metrics = performance(raw, token0, token1, flows);
  if (Object.values(metrics).some(value => typeof value === "number" && !Number.isFinite(value))) throw new Error("Revert 收益指标无效");
  const liquidity = positive(raw.liquidity);
  return {
    key: `${source.id}:revert:${exchange}:${tokenId}`,
    sourceId: source.id, chainId: source.chainId, network: source.network,
    protocol: source.id === "base-aerodrome" ? exchange === "aero" ? "Aero CL" : `Aerodrome CL (${exchange})` : source.protocol,
    pool, tokenId, kind: "concentrated",
    staked: flows.some(flow => flow.type === "current-reward-state" && flow.current === true && flow.staked === true),
    token0, token1, currentPrice, lowerPrice, upperPrice,
    valueQuote: positive(token0.amount * currentPrice + token1.amount),
    feePercent: numeric(raw.fee_tier) === undefined ? undefined : positive(raw.fee_tier) / 10_000,
    status: liquidity === 0 ? "empty" : raw.in_range ? "in-range" : "outside",
    updatedAt: new Date(time).toISOString(), explorerUrl: `${network.explorer}/address/${pool}`,
    dataSource: "revert", dataStale: stale || Date.now() - time > 180_000 || time > Date.now() + 5_000,
    revertUrl: `https://revert.finance/${exchange === "uniswapv3" ? "uniswap" : exchange === "pancakeswapv3" ? "pancake" : exchange}-position/${network.name}/${tokenId}`,
    performance: metrics, cashFlows: cashFlowSummary(flows),
    notes: ["数据由 Revert 索引服务返回，归属按 real_owner 核对；时间为数据源 now_ts。", "收益使用 Revert 返回的 HOLD / USD 基准，APR、ROI、手续费和奖励口径分别保留。", "本金不含待领手续费和奖励；该索引响应未提供可核验的快照区块号。"],
  };
}

export async function readRevertPortfolioPage(wallet: Address, source: PortfolioSource, cursor?: unknown, fresh = false): Promise<PortfolioPage> {
  const supported = exchanges(source);
  const state = decodeCursor(cursor, supported.length);
  const exchange = supported[state.phase];
  const url = new URL(`${API}/positions/${networks[source.chainId].name}/${exchange}/account/${wallet.toLowerCase()}/`);
  url.searchParams.set("active", "true");
  url.searchParams.set("limit", "25");
  if (state.after) url.searchParams.set("cursor", state.after);
  const page = await pageRequest(url, fresh);
  if (page.next === state.after && page.next !== undefined || page.next && page.rows.length === 0) throw new Error("Revert 分页未前进，请重新查询");
  const positions: PortfolioPosition[] = [];
  let failed = 0;
  for (const raw of page.rows) {
    try { positions.push(position(raw, wallet, source, exchange, page.stale)); }
    catch { failed++; }
  }
  const scanned = state.scanned + page.rows.length, total = state.priorTotal + page.total;
  const next = page.next ? { ...state, scanned, after: page.next } : state.phase + 1 < supported.length ? { phase: state.phase + 1, scanned, priorTotal: total } : undefined;
  const warnings: string[] = [];
  if (failed) warnings.push(`Revert 本页 ${failed} 个仓位未通过归属或数据校验，结果不完整。`);
  if (page.incomplete) warnings.push("Revert 仍有索引未完成，请稍后重试此来源。");
  if (page.stale || positions.some(item => item.dataStale)) warnings.push("Revert 返回了过期数据，请重新查询后再分析。");
  return { sourceId: source.id, positions, scanned, total, nextCursor: next ? encodeCursor(next) : undefined, warnings };
}

export async function readRevertPortfolioPosition(wallet: Address, source: PortfolioSource, key: unknown): Promise<PortfolioPosition> {
  if (typeof key !== "string" || key.length > 240) throw new Error("仓位标识无效");
  const parts = key.split(":");
  if (parts.length !== 4 || parts[0] !== source.id || parts[1] !== "revert" || !exchanges(source).includes(parts[2]) || !/^[1-9]\d{0,77}$/.test(parts[3])) throw new Error("仓位标识无效");
  const url = new URL(`${API}/positions/${networks[source.chainId].name}/${parts[2]}/${parts[3]}`);
  const result = position(await historyData(url), wallet, source, parts[2], false);
  if (result.key !== key) throw new Error("Revert 仓位标识已变化，请重新查询");
  return result;
}

async function historyData(url: URL) {
  const response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error("历史接口暂不可用");
  const text = await response.text();
  if (text.length > 8_000_000) throw new Error("历史响应超过读取上限");
  const body = record(JSON.parse(text));
  if (body.success !== true) throw new Error("历史响应不完整");
  return body.data;
}

function dailyIncome(value: unknown, from: string, today: string) {
  if (!Array.isArray(value)) return [];
  const days = new Map<string, { date: string; usd: number }>();
  for (const item of value) {
    const row = record(item), date = String(row.date), usd = numeric(row.usd);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date >= from && date < today && usd !== undefined && usd >= 0) days.set(date, { date, usd });
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function incomeSample(row: Row, at: string): DailyIncomeSample {
  try {
    const prices = record(row.prices);
    const rewards = row.total_rewards === null ? {} : record(row.total_rewards);
    const rewardPrices = prices.rewards ? record(prices.rewards) : {};
    return {
      at, principalUsd: numeric(row.underlying_value), fees0: numeric(row.total_fees0), fees1: numeric(row.total_fees1),
      price0Usd: numeric(record(prices.token0).usd), price1Usd: numeric(record(prices.token1).usd),
      rewards: Object.fromEntries(Object.entries(rewards).map(([token, amount]) => {
        const price = rewardPrices[token] ?? rewardPrices[token.toLowerCase()];
        return [address(token).toLowerCase(), { amount: numeric(amount), priceUsd: price ? numeric(record(price).usd) : undefined }];
      })),
    };
  } catch { return { at }; }
}

export async function readRevertPositionHistory(position: PortfolioPosition, options: { includePool?: boolean } = {}): Promise<PortfolioHistory> {
  const lookbackDays = 30;
  const now = Date.now(), today = new Date(now).toISOString().slice(0, 10);
  const cutoff = new Date(`${today}T00:00:00Z`).getTime() - lookbackDays * 86_400_000;
  const fromDate = new Date(cutoff).toISOString().slice(0, 10);
  const network = networks[position.chainId];
  const parts = position.key.split(":");
  if (!network || parts.length !== 4 || parts[1] !== "revert" || !["uniswapv3", "pancakeswapv3", "aero", "aerodrome", "aerodromev2", "aerodromev3"].includes(parts[2]) || parts[3] !== position.tokenId) throw new Error("Revert 历史仓位标识无效");
  const exchange = parts[2];
  const metricsUrl = new URL(`${API}/positions/${network.name}/${exchange}/${position.tokenId}/metrics-history`);
  const poolUrl = new URL(`${API}/discover-pools/daily`);
  for (const [key, value] of Object.entries({ network: network.name, exchange, pool: position.pool.toLowerCase(), days: String(lookbackDays) })) poolUrl.searchParams.set(key, value);
  const includePool = options.includePool !== false;
  const results = await Promise.allSettled([historyData(metricsUrl), includePool ? historyData(poolUrl) : Promise.resolve(undefined)]);
  const history: PortfolioHistory = {
    lookbackDays, fetchedAt: new Date().toISOString(),
    position: { status: "unavailable", sampleCount: 0, sourceSampleCount: 0, coveredDays: 0, downsampled: false, dailyFees: [], dailyRewards: [], snapshots: [] },
    pool: { status: "unavailable", sampleCount: 0, days: [] }, warnings: [],
  };
  if (results[0].status === "fulfilled") {
    try {
      const data = record(results[0].value), id = record(data.position_id);
      if (id.network !== network.name || id.exchange !== exchange || String(id.nft_id) !== position.tokenId || !Array.isArray(data.metrics_history)) throw new Error("历史身份不匹配");
      const points = new Map<string, PortfolioHistory["position"]["snapshots"][number]>();
      const incomePoints = new Map<string, DailyIncomeSample>();
      const anchors: RangeHistoryAnchor[] = [];
      let invalid = 0;
      for (const value of data.metrics_history) {
        try {
          const row = record(value), time = typeof row.block_ts === "string" ? Date.parse(row.block_ts) : NaN;
          if (!Number.isFinite(time) || time > now + 5_000 || row.network !== network.name || row.exchange !== exchange || String(row.nft_id) !== position.tokenId || String(row.pool_address).toLowerCase() !== position.pool.toLowerCase() || String(row.token0_address).toLowerCase() !== position.token0.address.toLowerCase() || String(row.token1_address).toLowerCase() !== position.token1.address.toLowerCase() || typeof row.in_range !== "boolean") throw new Error("历史快照无效");
          if (time < cutoff) continue;
          const prices = row.prices ? record(row.prices) : {};
          const price = prices.token0 ? numeric(record(prices.token0).token1) : undefined;
          points.set(new Date(time).toISOString(), { at: new Date(time).toISOString(), priceInToken1: price !== undefined && price > 0 ? price : undefined, inRange: row.in_range, active: typeof row.exited === "boolean" ? !row.exited : undefined, principalUsd: numeric(row.underlying_value) });
          incomePoints.set(new Date(time).toISOString(), incomeSample(row, new Date(time).toISOString()));
          const blockNumber = numeric(row.block_number);
          if (blockNumber !== undefined && Number.isSafeInteger(blockNumber) && blockNumber > 0) anchors.push({ at: new Date(time).toISOString(), blockNumber: BigInt(blockNumber) });
        } catch { invalid++; }
      }
      const snapshots = [...points.values()].sort((a, b) => a.at.localeCompare(b.at));
      const firstMint = numeric(data.first_mint_ts);
      const activityPoints = [...snapshots];
      if (!position.dataStale) activityPoints.push({ at: position.updatedAt, inRange: position.status === "in-range", active: position.status !== "empty" });
      history.rangeActivity = calculateRangeActivity({
        positionKey: position.key, snapshots: activityPoints,
        createdAt: firstMint !== undefined && firstMint > 0 && firstMint * 1000 <= now ? new Date(firstMint * 1000).toISOString() : undefined,
        asOf: new Date(now).toISOString(), downsampled: data.downsampled === true,
      });
      if (invalid) history.rangeActivity.warnings.push(`${invalid} 条历史记录未通过身份或字段校验。`);
      if (position.dataStale) history.rangeActivity.warnings.push("最新仓位快照已过期，近期时段等待更新。");
      const mintEvent = Array.isArray(data.events) ? data.events.find(event => event && typeof event === "object" && !Array.isArray(event) && event.type === "mint" && numeric(event.timestamp) === firstMint) as Row | undefined : undefined;
      const mintBlock = mintEvent && numeric(mintEvent.block_number);
      let mint: RangeHistoryMint | undefined;
      if (mintEvent && mintBlock !== undefined && Number.isSafeInteger(mintBlock) && mintBlock > 0 && typeof mintEvent.tx_hash === "string" && /^0x[0-9a-f]{64}$/i.test(mintEvent.tx_hash) && history.rangeActivity.createdAt) {
        mint = { at: history.rangeActivity.createdAt, blockNumber: BigInt(mintBlock), transactionHash: mintEvent.tx_hash as `0x${string}` };
      }
      history.rangeActivity = addDailyIncomeApr(await backfillRangeActivity(position, history.rangeActivity, anchors, mint), [...incomePoints.values()]);
      const prices = snapshots.flatMap(point => point.priceInToken1 === undefined ? [] : [point.priceInToken1]);
      const gaps = snapshots.slice(1).map((point, index) => (Date.parse(point.at) - Date.parse(snapshots[index].at)) / 3_600_000);
      const start = snapshots[0]?.at, end = snapshots.at(-1)?.at;
      history.position = {
        status: snapshots.length ? invalid ? "partial" : "ready" : "unavailable",
        sampleCount: snapshots.length, sourceSampleCount: numeric(data.total_snapshots) ?? data.metrics_history.length,
        from: start, to: end, coveredDays: start && end ? (Date.parse(end) - Date.parse(start)) / 86_400_000 : 0,
        downsampled: data.downsampled === true || snapshots.length > 60,
        maxGapHours: gaps.length ? Math.max(...gaps) : undefined,
        inRangeObservationPercent: snapshots.length ? snapshots.filter(point => point.inRange).length / snapshots.length * 100 : undefined,
        priceMin: prices.length ? Math.min(...prices) : undefined, priceMax: prices.length ? Math.max(...prices) : undefined,
        dailyFees: dailyIncome(data.daily_fees, fromDate, today), dailyRewards: dailyIncome(data.daily_rewards, fromDate, today),
        snapshots: snapshots.length > 60 ? Array.from({ length: 60 }, (_, index) => snapshots[Math.round(index * (snapshots.length - 1) / 59)]) : snapshots,
      };
      if (invalid) history.warnings.push(`${invalid} 条仓位历史记录未通过身份或字段校验。`);
      if (!snapshots.length) history.warnings.push("仓位近 30 天的历史快照暂不可用。");
    } catch { history.warnings.push("仓位历史响应校验失败，等待重试。"); }
  } else history.warnings.push("仓位历史接口暂不可用，等待重试。");
  if (includePool && results[1].status === "fulfilled") {
    try {
      if (!Array.isArray(results[1].value)) throw new Error("池历史格式无效");
      const days = new Map<string, PortfolioHistory["pool"]["days"][number]>();
      let invalid = 0;
      for (const value of results[1].value) {
        try {
          const row = record(value), date = String(row.day);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("日期无效");
          if (date < fromDate || date >= today) continue;
          const feesUsd = numeric(row.fees_usd), volumeUsd = numeric(row.volume_usd), tvlUsd = numeric(row.tvl_usd);
          if ([feesUsd, volumeUsd, tvlUsd].every(value => value === undefined) || [feesUsd, volumeUsd, tvlUsd].some(value => value !== undefined && value < 0)) throw new Error("池数据无效");
          days.set(date, { date, feesUsd, volumeUsd, tvlUsd, feeAprPercent: numeric(row.fees_apr), rewardsUsd: numeric(row.rewards_usd) });
        } catch { invalid++; }
      }
      const rows = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
      history.pool = {
        status: rows.length ? invalid || rows.length < lookbackDays ? "partial" : "ready" : "unavailable",
        sampleCount: rows.length, from: rows[0]?.date, to: rows.at(-1)?.date, days: rows,
        feesUsd: rows.length && rows.every(day => day.feesUsd !== undefined) ? rows.reduce((sum, day) => sum + day.feesUsd!, 0) : undefined,
        volumeUsd: rows.length && rows.every(day => day.volumeUsd !== undefined) ? rows.reduce((sum, day) => sum + day.volumeUsd!, 0) : undefined,
      };
      if (invalid) history.warnings.push(`${invalid} 条池日数据未通过校验。`);
      if (rows.length < lookbackDays) history.warnings.push(`池日数据实际覆盖 ${rows.length}/${lookbackDays} 个完整 UTC 日。`);
    } catch { history.warnings.push("池历史响应校验失败，等待重试。"); }
  } else if (includePool) history.warnings.push("池历史接口暂不可用，等待重试。");
  return history;
}
