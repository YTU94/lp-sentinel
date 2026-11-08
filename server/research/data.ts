import { createHash } from "node:crypto";

export const HOUR = 3600;
export const DAY = 24 * HOUR;
export const SUBGRAPH_ID = "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const USDT = "0xdac17f958d2ee523a2206206994597c13d831ec7";
export const POOLS = [
  { id: "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640", name: "WETH/USDC 0.05%", fee: 500, spacing: 10, base: WETH, decimals: 18, stable: false, weight: 0.25 },
  { id: "0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8", name: "WETH/USDC 0.3%", fee: 3000, spacing: 60, base: WETH, decimals: 18, stable: false, weight: 0.25 },
  { id: "0x3416cf6c708da44db2624d63ea0aaef7113527c6", name: "USDT/USDC 0.01%", fee: 100, spacing: 1, base: USDT, decimals: 6, stable: true, weight: 0.5 },
] as const;
export type Pool = typeof POOLS[number];
interface Token { id: string; decimals: string; symbol: string }
interface RawHour {
  periodStartUnix: number; sqrtPrice: string; liquidity: string;
  open: string; high: string; low: string; close: string; feesUSD: string; volumeUSD: string;
}
export interface RawPool {
  pool: { id: string; feeTier: string; token0: Token; token1: Token };
  poolHourDatas: RawHour[];
}
interface Meta { block: { number: number; hash: string; timestamp: number }; deployment: string; hasIndexingErrors: boolean }
export interface Dataset {
  version: 1; kind: "uniswap-v3-subgraph" | "synthetic-verification"; chainId: 1;
  start: number; end: number; retrievedAt: string; subgraphId: string | null; meta: Meta;
  quoteHours: { periodStartUnix: number; priceUSD: string }[];
  pools: RawPool[];
}
export interface Bar {
  time: number; open: number; high: number; low: number; close: number;
  liquidity: number; feesQuote: number;
}
export interface History { dataset: Dataset; hash: string; pools: { pool: Pool; bars: Bar[] }[] }
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`历史数据校验失败：${message}`);
}
function number(value: unknown, label: string, zero = false) {
  requireValue(typeof value === "number" || (typeof value === "string" && /^\d+(\.\d+)?$/.test(value)), label);
  const n = Number(value);
  requireValue(Number.isFinite(n) && (zero ? n >= 0 : n > 0), label);
  return n;
}

export function validateDataset(input: unknown): History {
  requireValue(input && typeof input === "object", "缺少数据对象");
  const data = input as Dataset;
  requireValue(data.version === 1 && data.chainId === 1, "仅接受 Ethereum V3 v1 数据格式");
  requireValue(["uniswap-v3-subgraph", "synthetic-verification"].includes(data.kind), "来源类型不明确");
  requireValue(Number.isSafeInteger(data.start) && data.start > 0 && data.start % DAY === 0
    && data.end - data.start === 30 * DAY && data.end <= Math.floor(Date.now() / 1000 / DAY) * DAY, "必须覆盖已结束的连续 30 个 UTC 日");
  requireValue(Number.isFinite(Date.parse(data.retrievedAt)) && Date.parse(data.retrievedAt) / 1000 >= data.end
    && Date.parse(data.retrievedAt) <= Date.now() + 60_000, "获取时间无效");
  requireValue(data.meta?.hasIndexingErrors === false && Number.isSafeInteger(data.meta.block?.number)
    && data.meta.block.number > 0 && data.meta.block.timestamp >= data.end
    && data.meta.block.timestamp <= Date.parse(data.retrievedAt) / 1000
    && /^0x[0-9a-f]{64}$/i.test(data.meta.block.hash) && typeof data.meta.deployment === "string"
    && data.meta.deployment.length > 0, "索引错误、区块身份缺失或索引尚未覆盖整个区间");
  requireValue(data.kind === "synthetic-verification" ? data.subgraphId === null : data.subgraphId === SUBGRAPH_ID, "subgraph 身份不符");
  requireValue(Array.isArray(data.quoteHours) && data.quoteHours.length === 720, "USDC 报价需完整 720 小时");
  const quotePrices = data.quoteHours.map((hour, i) => {
    requireValue(hour.periodStartUnix === data.start + i * HOUR, `USDC 第 ${i} 小时缺失、乱序或重复`);
    return number(hour.priceUSD, "USDC/USD");
  });
  requireValue(Array.isArray(data.pools) && data.pools.length === POOLS.length, "需要预先固定的三个池，禁止事后删选失败池");
  const pools = POOLS.map(pool => {
    const matches = data.pools.filter(raw => raw?.pool?.id === pool.id);
    requireValue(matches.length === 1, `${pool.name} 缺失或重复`);
    const raw = matches[0];
    requireValue(number(raw.pool.feeTier, "fee tier") === pool.fee && raw.pool.token0?.id === USDC
      && raw.pool.token1?.id === pool.base && number(raw.pool.token0.decimals, "quote decimals") === 6
      && number(raw.pool.token1.decimals, "base decimals") === pool.decimals, `${pool.name} 合约元数据不符`);
    requireValue(Array.isArray(raw.poolHourDatas) && raw.poolHourDatas.length === 720, `${pool.name} 需完整 720 小时，不自动填补缺口`);
    const bars = raw.poolHourDatas.map((hour, i): Bar => {
      requireValue(hour.periodStartUnix === data.start + i * HOUR, `${pool.name} 第 ${i} 小时缺失、乱序或重复`);
      let [open, high, low, close] = [hour.open, hour.high, hour.low, hour.close].map(v => number(v, "OHLC"));
      const ratio = number(hour.sqrtPrice, "sqrtPrice") / 2 ** 96;
      const quotePerBase = 10 ** (pool.decimals - 6) / ratio ** 2;
      if (Math.abs(close / quotePerBase - 1) > 1e-6 && Math.abs((1 / close) / quotePerBase - 1) < 1e-6) {
        [open, high, low, close] = [1 / open, 1 / low, 1 / high, 1 / close];
      }
      requireValue(Number.isFinite(quotePerBase) && Math.abs(close / quotePerBase - 1) < 1e-6, `${pool.name} OHLC 价格方向与 sqrtPrice 不符`);
      requireValue(low <= Math.min(open, close) * (1 + 1e-9) && high * (1 + 1e-9) >= Math.max(open, close) && high >= low, "OHLC 边界无效");
      const feesUSD = number(hour.feesUSD, "feesUSD", true);
      const volumeUSD = number(hour.volumeUSD, "volumeUSD", true);
      requireValue(feesUSD <= volumeUSD * pool.fee / 1e6 * 1.01 + 0.01, "手续费与成交量/fee tier 不符");
      return { time: hour.periodStartUnix, open, high, low, close,
        liquidity: number(hour.liquidity, "active liquidity"), feesQuote: feesUSD / quotePrices[i] };
    });
    return { pool, bars };
  });
  return { dataset: data, hash: digest(data), pools };
}

export async function collect(end = Math.floor(Date.now() / 1000 / DAY) * DAY): Promise<Dataset> {
  if (!process.env.THE_GRAPH_API_KEY) throw new Error("缺少 THE_GRAPH_API_KEY；未获取历史数据，不能开始真实训练");
  if (!Number.isSafeInteger(end) || end % DAY !== 0 || end <= 30 * DAY || end > Math.floor(Date.now() / 1000 / DAY) * DAY) throw new Error("结束日期必须是已到达的 UTC 日界线");
  async function query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`https://gateway.thegraph.com/api/subgraphs/id/${SUBGRAPH_ID}`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.THE_GRAPH_API_KEY}` },
        body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(30_000), redirect: "error",
      });
    } catch { throw new Error("历史索引服务连接失败或超时；未生成数据集"); }
    if (!response.ok) throw new Error(`历史索引服务 HTTP ${response.status}；请检查网络、API Key 和查询额度`);
    const body = await response.json() as { data?: T; errors?: unknown[] };
    if (body.errors?.length || !body.data) throw new Error("GraphQL 查询失败；索引部署或 schema 可能已变化，未接受不完整数据");
    return body.data;
  }
  const latest = await query<{ _meta: Meta }>("{ _meta { block { number hash timestamp } deployment hasIndexingErrors } }");
  if (latest._meta.hasIndexingErrors) throw new Error("索引存在错误，停止采集");
  const block = latest._meta.block.number - 64;
  const { _meta: meta } = await query<{ _meta: Meta }>("query($block:Int!) { _meta(block:{number:$block}) { block { number hash timestamp } deployment hasIndexingErrors } }", { block });
  const start = end - 30 * DAY;
  const { tokenHourDatas: quoteHours } = await query<{ tokenHourDatas: Dataset["quoteHours"] }>(`query($start:Int!,$end:Int!,$block:Int!,$token:String!) {
    tokenHourDatas(first:1000,orderBy:periodStartUnix,orderDirection:asc,block:{number:$block},where:{token:$token,periodStartUnix_gte:$start,periodStartUnix_lt:$end}) { periodStartUnix priceUSD }
  }`, { start, end, block, token: USDC });
  const pools: RawPool[] = [];
  for (const pool of POOLS) {
    pools.push(await query<RawPool>(`query($id:ID!,$pool:String!,$start:Int!,$end:Int!,$block:Int!) {
      pool(id:$id,block:{number:$block}) { id feeTier token0 { id decimals symbol } token1 { id decimals symbol } }
      poolHourDatas(first:1000,orderBy:periodStartUnix,orderDirection:asc,block:{number:$block},where:{pool:$pool,periodStartUnix_gte:$start,periodStartUnix_lt:$end}) {
        periodStartUnix sqrtPrice liquidity open high low close feesUSD volumeUSD
      }
    }`, { id: pool.id, pool: pool.id, start, end, block }));
  }
  const data: Dataset = { version: 1, kind: "uniswap-v3-subgraph", chainId: 1, start, end,
    retrievedAt: new Date().toISOString(), subgraphId: SUBGRAPH_ID, meta, quoteHours, pools };
  validateDataset(data);
  return data;
}
