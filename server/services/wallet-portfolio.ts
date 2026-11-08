import { getAddress, isAddress } from "viem";
import { portfolioSources, type PortfolioPage, type PortfolioToken } from "../../shared/portfolio.js";
import { readRevertPortfolioPage, readRevertPortfolioPosition, readRevertPositionHistory } from "./revert-portfolio.js";
import { readUniswapPoolUniverse, uniswapMarketContext } from "./uniswap-pool-universe.js";
import type { LpRangeActivity } from "../../shared/range-activity.js";

export function walletAddress(input: unknown) {
  if (typeof input !== "string" || !isAddress(input.trim(), { strict: false }) || /^0x0{40}$/i.test(input.trim())) throw new Error("请输入有效的 EVM 钱包地址（0x 开头的 42 位地址）");
  return getAddress(input.trim().toLowerCase());
}

export function portfolioSource(input: unknown) {
  const source = portfolioSources.find(item => item.id === input);
  if (!source) throw new Error("不支持的链或 LP 平台");
  return source;
}

const stockMetadata = new Map<string, NonNullable<PortfolioToken["stock"]>>();
const rangeActivityCache = new Map<string, LpRangeActivity>();
const rangeActivityRequests = new Map<string, Promise<LpRangeActivity>>();
let stockExpiresAt = 0;
let stockRequest: Promise<boolean> | undefined;

async function loadStockMetadata() {
  if (Date.now() < stockExpiresAt) return stockMetadata.size > 0;
  return stockRequest ??= (async () => {
    try {
      const response = await fetch("https://api.robinhood.com/rhj/assets", { signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error("metadata unavailable");
      const data = await response.json() as { assets?: unknown[] };
      if (!Array.isArray(data.assets)) throw new Error("invalid metadata");
      const entries = new Map<string, NonNullable<PortfolioToken["stock"]>>();
      for (const raw of data.assets) {
        const asset = raw as { tokenName?: unknown; currentMultiplier?: unknown; status?: unknown; deployments?: { chainId?: unknown; contractAddress?: unknown }[] };
        if (typeof asset.tokenName !== "string" || typeof asset.currentMultiplier !== "string" || !/^\d+(\.\d+)?$/.test(asset.currentMultiplier) || !Array.isArray(asset.deployments)) continue;
        for (const deployment of asset.deployments) {
          if (!Number.isSafeInteger(deployment.chainId) || typeof deployment.contractAddress !== "string" || !isAddress(deployment.contractAddress, { strict: false })) continue;
          entries.set(`${deployment.chainId}:${deployment.contractAddress.toLowerCase()}`, {
            issuer: "Robinhood", name: asset.tokenName.slice(0, 160), multiplier: asset.currentMultiplier.slice(0, 80), status: String(asset.status ?? "未知").slice(0, 80),
          });
        }
      }
      stockMetadata.clear();
      entries.forEach((value, key) => stockMetadata.set(key, value));
      stockExpiresAt = Date.now() + 300_000;
      return entries.size > 0;
    } catch {
      stockMetadata.clear();
      stockExpiresAt = Date.now() + 30_000;
      return false;
    } finally { stockRequest = undefined; }
  })();
}

export async function readWalletPortfolioPage(rawAddress: unknown, rawSource: unknown, cursor?: unknown, fresh = false): Promise<PortfolioPage> {
  const address = walletAddress(rawAddress);
  const source = portfolioSource(rawSource);
  const [page, stockAvailable] = await Promise.all([
    readRevertPortfolioPage(address, source, cursor, fresh),
    loadStockMetadata(),
  ]);
  if (!stockAvailable) page.warnings.push("股票代币发行方目录暂不可用；持仓仍返回，股票身份暂未核验。");
  for (const position of page.positions) {
    for (const token of [position.token0, position.token1]) {
      token.stock = stockMetadata.get(`${source.chainId}:${token.address.toLowerCase()}`);
    }
  }
  return page;
}

export async function refreshPortfolioPosition(rawAddress: unknown, rawSource: unknown, key: unknown) {
  const address = walletAddress(rawAddress);
  const source = portfolioSource(rawSource);
  const [position, stockAvailable] = await Promise.all([readRevertPortfolioPosition(address, source, key), loadStockMetadata()]);
  for (const token of [position.token0, position.token1]) token.stock = stockMetadata.get(`${source.chainId}:${token.address.toLowerCase()}`);
  if (!stockAvailable) position.notes.push("股票代币发行方目录暂不可用，身份暂未核验。");
  const time = Date.parse(position.updatedAt);
  if (position.dataStale || !Number.isFinite(time) || Date.now() - time > 180_000 || time > Date.now() + 5_000) throw new Error("Revert 快照已过期，请稍后重新查询");
  const [history, universe] = await Promise.allSettled([readRevertPositionHistory(position), readUniswapPoolUniverse()]);
  if (history.status === "rejected") throw history.reason;
  position.history = history.value;
  if (universe.status === "fulfilled") position.history.market = uniswapMarketContext(position, universe.value);
  else position.history.warnings.push("Uniswap TVL Top 50 历史样本暂不可用，本次仅分析已取得的仓位与池历史。");
  return position;
}

export function readPortfolioRangeActivity(rawAddress: unknown, rawSource: unknown, key: unknown, fresh = false): Promise<LpRangeActivity> {
  const address = walletAddress(rawAddress);
  const source = portfolioSource(rawSource);
  if (typeof key !== "string" || key.length > 240 || !key.startsWith(`${source.id}:revert:`)) throw new Error("仓位标识无效");
  const id = `${address.toLowerCase()}:${key}`;
  const cached = rangeActivityCache.get(id);
  if (!fresh && cached && Date.now() < Date.parse(cached.expiresAt)) return Promise.resolve(cached);
  const pending = rangeActivityRequests.get(id);
  if (pending) return pending;
  if (rangeActivityRequests.size >= 4) throw new Error("历史查询繁忙，请稍后重试");
  const request = (async () => {
    const position = await readRevertPortfolioPosition(address, source, key);
    const history = await readRevertPositionHistory(position, { includePool: false });
    if (!history.rangeActivity) throw new Error("Revert 有效区间历史暂不可用，请稍后重试");
    rangeActivityCache.set(id, history.rangeActivity);
    while (rangeActivityCache.size > 128) rangeActivityCache.delete(rangeActivityCache.keys().next().value!);
    return history.rangeActivity;
  })().finally(() => { rangeActivityRequests.delete(id); });
  rangeActivityRequests.set(id, request);
  return request;
}
