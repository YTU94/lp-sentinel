import { portfolioSources, type PortfolioHistory, type PortfolioPosition } from "../../shared/portfolio.js";
import type { SampleHistory, SampleSnapshot, SampleView, WalletSample } from "../../shared/samples.js";
import { readRevertPortfolioPage, readRevertPositionHistory } from "../services/revert-portfolio.js";
import { readUniswapPoolUniverse } from "../services/uniswap-pool-universe.js";
import { walletAddress } from "../services/wallet-portfolio.js";
import type { JsonStore } from "../store.js";

const sources = portfolioSources.filter(source => source.protocol === "Uniswap V3");
const retryDelay = 60 * 60 * 1000;

function nextDailyUpdate(now: number) {
  const date = new Date(now);
  date.setUTCHours(0, 10, 0, 0);
  if (date.getTime() <= now) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

function compactHistory(history: PortfolioHistory): SampleHistory {
  return {
    ...history,
    rangeActivity: history.rangeActivity && {
      ...history.rangeActivity,
      days: history.rangeActivity.days.map(({ segments: _segments, ...day }) => day),
    },
  };
}

function unavailableHistory(): PortfolioHistory {
  return {
    lookbackDays: 30, fetchedAt: new Date().toISOString(),
    position: { status: "unavailable", sampleCount: 0, sourceSampleCount: 0, coveredDays: 0, downsampled: false, dailyFees: [], dailyRewards: [], snapshots: [] },
    pool: { status: "unavailable", sampleCount: 0, days: [] },
    warnings: ["仓位与池历史暂不可用，等待下次更新。"],
  };
}

export class SampleCollector {
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<void>;
  private revision = 0;
  private stopped = true;
  private storageError?: string;
  private retryNotBefore = 0;

  constructor(
    private readonly store: Pick<JsonStore, "snapshot" | "update">,
    private readonly services = { page: readRevertPortfolioPage, history: readRevertPositionHistory, universe: readUniswapPoolUniverse },
  ) {}

  get view(): SampleView {
    const state = this.store.snapshot.samples ?? {};
    const universe = state.snapshot?.universe;
    if (universe && (universe.pools.length < universe.requestedPools || universe.sampledPools < universe.pools.length)) {
      const retryAt = Date.parse(state.lastAttemptAt ?? state.snapshot!.capturedAt) + retryDelay;
      if (Number.isFinite(retryAt) && (!state.nextUpdateAt || retryAt < Date.parse(state.nextUpdateAt))) state.nextUpdateAt = new Date(retryAt).toISOString();
    }
    if (state.processing && !this.pending) state.nextUpdateAt = new Date().toISOString();
    if (this.retryNotBefore > Date.now()) state.nextUpdateAt = new Date(Math.max(this.retryNotBefore, Date.parse(state.nextUpdateAt ?? "") || 0)).toISOString();
    return { ...state, error: this.storageError ?? state.error, updating: Boolean(this.pending) };
  }

  start() { this.stopped = false; this.schedule(); }
  stop() { this.stopped = true; clearTimeout(this.timer); }

  async setWallet(input: unknown, queriedAt?: unknown) {
    const address = input === null ? undefined : walletAddress(input);
    const now = Date.now();
    const time = input === null ? now : Number(queriedAt);
    if (!Number.isFinite(time) || time > now + 5_000 || time < now - 86_400_000) throw new Error("查询时间无效，请重新查询钱包。");
    let changed = false;
    await this.store.update(data => {
      const current = data.samples ?? {};
      if (input !== null && time < (current.walletQueriedAt ?? 0)) return;
      const effectiveTime = input === null ? Math.max(now, current.walletQueriedAt ?? 0) + 1 : time;
      changed = current.wallet?.toLowerCase() !== address?.toLowerCase();
      data.samples = changed
        ? { wallet: address, walletQueriedAt: effectiveTime, nextUpdateAt: new Date(now).toISOString() }
        : { ...current, walletQueriedAt: effectiveTime };
    });
    if (changed) { this.revision++; this.schedule(); }
    return this.view;
  }

  refresh() {
    if (this.pending) return this.pending;
    const revision = this.revision;
    const wallet = this.view.wallet;
    const work = this.collect(wallet, revision);
    this.pending = work;
    void work.then(() => {
      this.storageError = undefined; this.retryNotBefore = 0; this.pending = undefined; this.schedule();
    }, () => {
      this.storageError = "样本文件无法保存，请检查本地目录权限；1 小时后重试。";
      this.retryNotBefore = Date.now() + retryDelay; this.pending = undefined; this.schedule();
    });
    return work;
  }

  private schedule() {
    clearTimeout(this.timer);
    if (this.stopped || this.pending) return;
    const next = Date.parse(this.view.nextUpdateAt ?? "");
    const delay = Number.isFinite(next) ? Math.max(0, next - Date.now()) : 0;
    this.timer = setTimeout(() => { void this.refresh().catch(() => undefined); }, delay);
  }

  private async collect(wallet: string | undefined, revision: number) {
    const started = new Date().toISOString();
    await this.store.update(data => { data.samples = { ...data.samples, lastAttemptAt: started, processing: true, error: undefined }; });
    try {
      const { snapshot, retry } = await this.read(wallet);
      if (revision !== this.revision) return;
      await this.store.update(data => {
        if (revision !== this.revision || data.samples?.wallet?.toLowerCase() !== wallet?.toLowerCase()) return;
        const previous = data.samples?.snapshot;
        const previousWalletSnapshot = snapshot.mode === "top50" && retry
          ? previous?.mode === "wallet" ? previous : data.samples?.previousWalletSnapshot
          : undefined;
        data.samples = { ...data.samples, snapshot, previousWalletSnapshot, processing: false, error: undefined, nextUpdateAt: retry ? new Date(Date.now() + retryDelay).toISOString() : nextDailyUpdate(Date.now()) };
      });
    } catch (error) {
      if (revision !== this.revision) return;
      const cause = error instanceof Error ? error.cause as NodeJS.ErrnoException | undefined : undefined;
      const code = typeof cause?.code === "string" && /^[A-Z0-9_]{1,40}$/.test(cause.code) ? `（${cause.code}）` : "";
      const reason = error instanceof Error && error.message.startsWith("Uniswap ") ? `：${error.message}`
        : error instanceof Error && error.name === "TimeoutError" ? "：数据源连接超时" : code ? `：数据源连接失败${code}` : "";
      await this.store.update(data => {
        if (revision !== this.revision || data.samples?.wallet?.toLowerCase() !== wallet?.toLowerCase()) return;
        data.samples = { ...data.samples, processing: false, error: `样本更新失败${reason}，保留上次结果；服务会在 1 小时后重试。`, nextUpdateAt: new Date(Date.now() + retryDelay).toISOString() };
      });
    }
  }

  private async read(wallet?: string): Promise<{ snapshot: SampleSnapshot; retry: boolean }> {
    const warnings: string[] = [];
    let retry = false;
    let positions: PortfolioPosition[] = [];
    if (wallet) {
      const scans = await Promise.all(sources.map(async source => {
        const found: PortfolioPosition[] = [];
        let cursor: string | undefined, pages = 0, incomplete = false;
        try {
          do {
            if (++pages > 100) throw new Error("分页上限");
            const page = await this.services.page(wallet as `0x${string}`, source, cursor, true);
            found.push(...page.positions);
            incomplete ||= page.warnings.length > 0 || page.positions.some(position => position.dataStale);
            cursor = page.nextCursor;
          } while (cursor);
        } catch { incomplete = true; }
        return { source, found, incomplete };
      }));
      for (const scan of scans) {
        positions.push(...scan.found);
        if (scan.incomplete) { warnings.push(`${scan.source.network} 来源未完成或数据过期，钱包覆盖可能不完整。`); retry = true; }
      }
      positions = [...new Map(positions.filter(position => position.status !== "empty").map(position => [position.key, position])).values()];
    }

    const samples: WalletSample[] = new Array(positions.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(2, positions.length) }, async () => {
      while (next < positions.length) {
        const index = next++, position = positions[index];
        let history: PortfolioHistory;
        try { history = await this.services.history(position); }
        catch { history = unavailableHistory(); }
        if (history.position.status === "unavailable" || history.pool.status === "unavailable") retry = true;
        const { key, sourceId, network, tokenId, token0, token1, status, currentPrice, lowerPrice, upperPrice, updatedAt, dataStale } = position;
        samples[index] = { position: { key, sourceId, network, tokenId, token0, token1, status, currentPrice, lowerPrice, upperPrice, updatedAt, dataStale }, history: compactHistory(history) };
      }
    }));

    if (samples.some(sample => sample.history.position.sampleCount > 0 || sample.history.pool.sampleCount > 0)) {
      return { snapshot: { mode: "wallet", wallet, capturedAt: new Date().toISOString(), positions: samples, warnings }, retry };
    }
    const fallbackReason = !wallet ? "尚未成功查询钱包。" : !positions.length
      ? retry ? "钱包来源未全部完成，暂无法确认是否有 Uniswap 仓位。" : "钱包未发现非空 Uniswap V3 仓位。"
      : "钱包仓位的历史样本暂不可用。";
    const universe = await this.services.universe();
    return { snapshot: { mode: "top50", wallet, capturedAt: new Date().toISOString(), positions: samples, universe, fallbackReason, warnings }, retry: retry || universe.pools.length < universe.requestedPools || universe.sampledPools < universe.pools.length };
  }
}
