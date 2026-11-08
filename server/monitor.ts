import { evaluateAlert } from "./domain/alert-engine.js";
import { simulateConcentratedPosition } from "./domain/lp-math.js";
import type { JsonStore } from "./store.js";
import { fetchBinancePrice } from "./services/binance-price.js";
import { getDwsIdentity } from "./services/dws-auth.js";
import { sendNotification } from "./services/dws-notifier.js";
import { readLpNftBySource } from "./services/lp-nft-registry.js";
import { chainSnapshotFromLiveLp } from "./domain/live-lp-import.js";
import { feeSampleFromSnapshot, updateFeeApr1h } from "./domain/fee-apr.js";
import type { LivePositionSource } from "./domain/position.js";

type LivePositionUpdate = Pick<Awaited<ReturnType<typeof readLpNftBySource>>,
  "currentPrice" | "amount0" | "amount1" | "positionValueQuote" |
  "formattedOwed0" | "formattedOwed1" | "blockNumber" | "updatedAt"
>;

interface MonitorDependencies {
  priceProvider: typeof fetchBinancePrice;
  lpPositionProvider?: (tokenId: bigint, sourceId: LivePositionSource["type"]) => Promise<LivePositionUpdate>;
  identityProvider: typeof getDwsIdentity;
  notifier: typeof sendNotification;
}

const defaultDependencies: MonitorDependencies = {
  priceProvider: fetchBinancePrice,
  lpPositionProvider: readLpNftBySource,
  identityProvider: getDwsIdentity,
  notifier: sendNotification,
};

export function nextPollDelay(intervalMs: number, elapsedMs: number) {
  return Math.max(0, intervalMs - elapsedMs);
}

export class PositionMonitor {
  private timer?: NodeJS.Timeout;
  private checking = false;

  constructor(
    private readonly store: JsonStore,
    private readonly dependencies: MonitorDependencies = defaultDependencies,
    private readonly onChecked?: () => Promise<void>,
  ) {}

  start() {
    void this.checkAll();
    this.schedule();
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
  }

  reschedule() {
    this.stop();
    this.schedule();
  }

  async checkAll() {
    if (this.checking) return;
    this.checking = true;
    try {
      const positions = this.store.snapshot.positions.filter((position) => position.enabled);
      await Promise.all(positions.map((position) => this.checkOne(position.id)));
    } finally {
      this.checking = false;
      try { await this.onChecked?.(); }
      catch { console.error("策略事件保存失败；监控将在下一轮继续"); }
    }
  }

  private schedule(delayMs?: number) {
    const interval = Math.max(5, this.store.snapshot.settings.pollIntervalSeconds) * 1_000;
    this.timer = setTimeout(async () => {
      const startedAt = Date.now();
      await this.checkAll();
      this.schedule(nextPollDelay(interval, Date.now() - startedAt));
    }, delayMs ?? interval);
  }

  private async checkOne(id: string) {
    const original = this.store.snapshot.positions.find((item) => item.id === id);
    if (!original) return;
    let priceRead = false;
    try {
      const livePosition = original.source
        ? await (this.dependencies.lpPositionProvider ?? readLpNftBySource)(BigInt(original.source.tokenId), original.source.type)
        : undefined;
      const price = livePosition?.currentPrice ?? await this.dependencies.priceProvider(original.symbol);
      const chainSnapshot = livePosition
        ? chainSnapshotFromLiveLp(livePosition, original.baseAsset, original.quoteAsset)
        : undefined;
      priceRead = true;
      const alertResult = evaluateAlert(original.alertState, price, original.alertLower, original.alertUpper);
      const simulation = simulateConcentratedPosition({
        capitalQuote: original.capitalQuote,
        currentPrice: price,
        referencePrice: original.entryPrice,
        lowerPrice: original.lowerPrice,
        upperPrice: original.upperPrice,
      });
      const now = new Date().toISOString();
      const identityRequest = alertResult.event ? this.dependencies.identityProvider() : undefined;
      const pricePersistence = this.store.update((data) => {
        const position = data.positions.find((item) => item.id === id);
        if (!position) return;
        if (chainSnapshot) {
          let history = position.chainHistory;
          if ((!history || history.length === 0) && position.chainSnapshot) {
            history = [feeSampleFromSnapshot(position.chainSnapshot, position.currentPrice ?? price)];
          }
          const feeWindow = updateFeeApr1h(history, feeSampleFromSnapshot(chainSnapshot, price));
          chainSnapshot.feeApr1h = feeWindow.feeApr1h;
          position.chainHistory = feeWindow.history;
        }
        Object.assign(position, { currentPrice: price, priceUpdatedAt: now, priceReadFailed: false, simulation, chainSnapshot, lastError: undefined });
        if (!alertResult.event) position.alertState = alertResult.state;
      }).then(() => ({ error: undefined }), (error: unknown) => ({ error }));

      if (alertResult.event) {
        const identity = await identityRequest!;
        if (!identity.authenticated || !identity.userId) throw new Error(identity.error || "DWS 尚未登录");
        const sideText = alertResult.event.side === "upper" ? "上限" : "下限";
        const message = [
          `【${original.name}】价格触及${sideText}预警`,
          `当前价格：${price} ${original.quoteAsset}`,
          `预警价格：${alertResult.event.threshold} ${original.quoteAsset}`,
          `LP 区间：${original.lowerPrice} — ${original.upperPrice}`,
          `状态：${simulation.status === "in-range" ? "区间内" : "已出区间"}`,
        ].join("\n");
        const settings = this.store.snapshot.settings;
        const delivery = await this.dependencies.notifier({
          userId: identity.userId,
          message,
          dingEnabled: settings.dingEnabled,
          dingCallEnabled: settings.dingCallEnabled,
          robotCode: settings.dingRobotCode,
        });
        const persistence = await pricePersistence;
        if (persistence.error) throw persistence.error;
        await this.store.update((data) => {
          const position = data.positions.find((item) => item.id === id);
          if (!position) return;
          position.alertState = alertResult.state;
          position.lastAlertAt = new Date().toISOString();
          position.lastError = delivery.dingError
            ? `普通消息已发送；DING 发送失败：${delivery.dingError}`
            : undefined;
        });
      } else {
        const persistence = await pricePersistence;
        if (persistence.error) throw persistence.error;
      }
    } catch (error) {
      await this.store.update((data) => {
        const position = data.positions.find((item) => item.id === id);
        if (position) {
          position.lastError = error instanceof Error ? error.message : "监控失败";
          if (!priceRead) position.priceReadFailed = true;
        }
      });
    }
  }
}
