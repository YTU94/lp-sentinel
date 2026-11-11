import { randomUUID } from "node:crypto";
import type { Address } from "viem";
import { portfolioSources, type PortfolioPosition, type PortfolioSource, type PortfolioWatchPosition, type PortfolioWatchState, type WatchAdvice } from "../../shared/portfolio.js";
import { JsonStore } from "../store.js";
import { getDwsIdentity, getDwsRecipient } from "../services/dws-auth.js";
import { sendPortfolioNotification } from "../services/dws-notifier.js";
import { readRevertPortfolioPage, readRevertPortfolioPosition } from "../services/revert-portfolio.js";
import { refreshPortfolioPosition, walletAddress } from "../services/wallet-portfolio.js";
import { confirmPortfolioExit } from "../services/portfolio-exit-confirmation.js";
import { analyzePortfolioPosition } from "./portfolio-analysis.js";

const INTERVAL = 30_000;
const MAX_GAP = 90_000;
const CONFIRM = 300_000;
const RETRY = 60_000;
const iso = (time = Date.now()) => new Date(time).toISOString();

function validPosition(position: PortfolioPosition, now: number) {
  const time = Date.parse(position.updatedAt);
  if (position.dataStale || !Number.isFinite(time) || now - time > 180_000 || time > now + 5_000) return false;
  if (position.status === "empty") return true;
  const { currentPrice, lowerPrice, upperPrice } = position;
  if (!currentPrice || !lowerPrice || !upperPrice || upperPrice <= lowerPrice) return false;
  const outside = currentPrice < lowerPrice || currentPrice >= upperPrice;
  return position.status === (outside ? "outside" : "in-range");
}

function interrupt(position: PortfolioWatchPosition) {
  position.status = "unknown";
  position.verifiedAt = undefined;
  if (position.alerted) {
    position.outsideSince = undefined;
    position.snapshotSince = undefined;
    if (!position.taskId) position.confirmedAt = undefined;
    if (position.delivery === "sending") position.delivery = "uncertain";
    return;
  }
  position.outsideSince = undefined;
  position.snapshotSince = undefined;
  position.eventId = undefined;
  position.confirmedAt = undefined;
  position.advice = undefined;
  position.delivery = "none";
  position.error = undefined;
  position.retryAt = undefined;
}

export function observePortfolioWatch(current: PortfolioWatchPosition | undefined, position: PortfolioPosition, now: number): PortfolioWatchPosition {
  const next: PortfolioWatchPosition = current ?? {
    key: position.key, sourceId: position.sourceId, network: position.network,
    pair: "", delivery: "none", status: "unknown", alerted: false,
  };
  next.pair = `${position.token0.symbol} / ${position.token1.symbol}`;
  next.tokenId = position.tokenId;
  if (!validPosition(position, now)) { interrupt(next); return next; }
  const sourceTime = Date.parse(position.updatedAt);
  const previousSourceTime = Date.parse(next.snapshotAt ?? "");
  if (Number.isFinite(previousSourceTime) && sourceTime <= previousSourceTime) {
    if (sourceTime < previousSourceTime || now - Date.parse(next.observedAt ?? "") > MAX_GAP) interrupt(next);
    return next;
  }
  if (next.observedAt && now - Date.parse(next.observedAt) > MAX_GAP) interrupt(next);
  next.observedAt = iso(now);
  next.snapshotAt = position.updatedAt;
  if (position.status !== "outside") {
    return {
      key: next.key, sourceId: next.sourceId, network: next.network, pair: next.pair, tokenId: next.tokenId,
      status: position.status === "empty" ? "empty" : "in-range", observedAt: next.observedAt,
      snapshotAt: next.snapshotAt, delivery: "none", alerted: false,
    };
  }
  next.status = "outside";
  if (!next.alerted && !next.outsideSince) {
    next.outsideSince = iso(now);
    next.snapshotSince = position.updatedAt;
    next.eventId = randomUUID();
  }
  if (!next.alerted && !next.confirmedAt && next.outsideSince && next.snapshotSince
      && now - Date.parse(next.outsideSince) >= CONFIRM && sourceTime - Date.parse(next.snapshotSince) >= CONFIRM) {
    next.confirmedAt = iso(now);
    next.delivery = "waiting";
  }
  return next;
}

function message(position: PortfolioPosition, state: PortfolioWatchPosition, advice?: WatchAdvice) {
  const price = (value?: number) => value === undefined ? "—" : new Intl.NumberFormat("zh-CN", { maximumSignificantDigits: 7 }).format(value);
  return [
    `${state.network} · ${state.pair}${state.tokenId ? ` · NFT #${state.tokenId}` : ""}`,
    "链上 Swap 事件核验：最近 5 分钟未回到区间。",
    `池价 ${price(position.currentPrice)}；区间 ${price(position.lowerPrice)} — ${price(position.upperPrice)} ${position.token1.symbol}/${position.token0.symbol}`,
    `数据时间：${position.updatedAt}`,
    advice && `AI 建议：${advice.summary}`,
    advice?.options && `保守方案：${advice.options.conservative.summary}；${advice.options.conservative.trigger}`,
    advice?.options && `激进方案：${advice.options.aggressive.summary}；${advice.options.aggressive.trigger}`,
    !advice?.options && advice?.strategy && `调整策略：${advice.strategy}`,
    !advice?.options && advice?.trigger && `触发条件：${advice.trigger}`,
    advice && `依据：${advice.reasons.join("；")}`,
    advice && `下一步：${advice.nextSteps.join("；")}`,
    advice && `风险：${advice.risks.join("；")}`,
    advice && "仅供决策参考，任何交易需自行确认。",
  ].filter(Boolean).join("\n");
}

export class PortfolioWatch {
  private timer?: ReturnType<typeof setInterval>;
  private scanning = new Set<string>();
  private jobs = new Set<string>();
  private startedAt = 0;
  private stopped = false;

  constructor(private readonly store: Pick<JsonStore, "snapshot" | "update">, private readonly withAdvice = true) {}

  get view() { return this.store.snapshot.portfolioWatch; }

  async start() {
    this.startedAt = Date.now();
    this.stopped = false;
    if (this.store.snapshot.portfolioWatch?.enabled) {
      await this.store.update(data => {
        for (const item of Object.values(data.portfolioWatch?.positions ?? {})) {
          if (item.delivery === "sending" && !item.taskId) {
            item.delivery = "uncertain";
            item.error = "服务中断，钉钉发送结果未知，请人工核对";
          }
        }
      });
    }
    this.timer = setInterval(() => this.tick(), INTERVAL);
    this.tick();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
  }

  async configure(input: unknown) {
    if (!input || typeof input !== "object") throw new Error("监控设置无效");
    const body = input as { enabled?: unknown; address?: unknown; clear?: unknown };
    if (typeof body.enabled !== "boolean" || body.clear !== undefined && typeof body.clear !== "boolean") throw new Error("监控设置无效");
    const address = body.enabled ? walletAddress(body.address) : undefined;
    await this.store.update(data => {
      const old = data.portfolioWatch;
      if (body.clear && !body.enabled) { delete data.portfolioWatch; return; }
      if (!body.enabled) {
        if (old) {
          old.enabled = false;
          old.sessionId = randomUUID();
          for (const item of Object.values(old.positions)) interrupt(item);
        }
        return;
      }
      const same = old?.address.toLowerCase() === address!.toLowerCase();
      const positions = same ? old!.positions : {};
      for (const item of Object.values(positions)) interrupt(item);
      data.portfolioWatch = { enabled: true, address: address!, sessionId: randomUUID(), positions, sources: {} };
    });
    this.startedAt = Date.now();
    this.tick();
    return this.store.snapshot.portfolioWatch;
  }

  private tick() {
    const watch = this.store.snapshot.portfolioWatch;
    if (this.stopped || !watch?.enabled) return;
    for (const source of portfolioSources) {
      if (this.scanning.has(source.id)) continue;
      this.scanning.add(source.id);
      void this.scanSource(watch, source).catch(() => undefined).finally(() => this.scanning.delete(source.id));
    }
    this.pump();
  }

  private async scanSource(watch: PortfolioWatchState, source: PortfolioSource) {
    const positions: PortfolioPosition[] = [];
    let failure = "";
    try {
      let cursor: string | undefined;
      let pages = 0;
      do {
        if (++pages > 100) throw new Error("仓位分页超过安全上限");
        const page = await readRevertPortfolioPage(watch.address as Address, source, cursor, true);
        if (page.warnings.length) throw new Error(page.warnings.join(" "));
        positions.push(...page.positions);
        cursor = page.nextCursor;
      } while (cursor);
    } catch (error) { failure = error instanceof Error ? error.message : "来源读取失败"; }
    const now = Date.now();
    await this.store.update(data => {
      const current = data.portfolioWatch;
      if (this.stopped || !current?.enabled || current.sessionId !== watch.sessionId) return;
      current.sources[source.id] = { checkedAt: iso(now), ...(failure ? { error: failure.slice(0, 200) } : {}) };
      const seen = new Set(positions.map(item => item.key));
      for (const item of Object.values(current.positions)) {
        if (item.sourceId === source.id && (failure || !seen.has(item.key))) interrupt(item);
      }
      if (!failure) for (const item of positions) current.positions[item.key] = observePortfolioWatch(current.positions[item.key], item, now);
    });
    this.pump();
  }

  private pump() {
    const watch = this.store.snapshot.portfolioWatch;
    if (this.stopped || !watch?.enabled) return;
    for (const position of Object.values(watch.positions)) {
      if (this.jobs.size >= 2) break;
      const id = `${watch.sessionId}:${position.eventId}`;
      if (!position.eventId || (!position.confirmedAt && !position.taskId) || this.jobs.has(id) || position.delivery === "sent") continue;
      if (position.alerted && !position.taskId) continue;
      if (position.retryAt && Date.parse(position.retryAt) > Date.now()) continue;
      if (!position.taskId && (position.status !== "outside" || !position.observedAt || Date.parse(position.observedAt) < this.startedAt || Date.now() - Date.parse(position.observedAt) > MAX_GAP)) continue;
      this.jobs.add(id);
      void this.handle(watch, position).catch(() => undefined).finally(() => { this.jobs.delete(id); this.pump(); });
    }
  }

  private async change(watch: PortfolioWatchState, state: PortfolioWatchPosition, mutate: (item: PortfolioWatchPosition) => void) {
    let changed = false;
    await this.store.update(data => {
      const current = data.portfolioWatch;
      const item = current?.positions[state.key];
      if (!this.stopped && current?.enabled && current.sessionId === watch.sessionId && item && state.eventId && item.eventId === state.eventId) {
        mutate(item);
        changed = true;
      }
    });
    return changed;
  }

  private active(watch: PortfolioWatchState, state: PortfolioWatchPosition) {
    const current = this.store.snapshot.portfolioWatch;
    const item = current?.positions[state.key];
    return current?.enabled && current.sessionId === watch.sessionId && item && state.eventId && item.eventId === state.eventId
      && item.status === "outside" && item.observedAt && Date.now() - Date.parse(item.observedAt) <= MAX_GAP ? item : undefined;
  }

  private async handle(watch: PortfolioWatchState, initial: PortfolioWatchPosition) {
    let state = initial;
    try {
      if (state.taskId) {
        const identity = await getDwsIdentity();
        if (!identity.authenticated || `${identity.corpId}:${identity.userId}` !== state.deliveryProfile) throw new Error("请登录发送提醒时使用的钉钉账号以核验投递结果");
        const result = await sendPortfolioNotification(state.deliveryProfile!, "", "", state.eventId!, state.taskId);
        await this.change(watch, state, item => {
          item.delivery = result.state;
          item.error = result.state === "sent" ? undefined : "钉钉已受理，等待投递结果";
          item.retryAt = result.state === "sent" ? undefined : iso(Date.now() + RETRY);
        });
        return;
      }
      const source = portfolioSources.find(item => item.id === state.sourceId);
      if (!source || !this.active(watch, state)) return;
      if (!state.verifiedAt) {
        const position = await readRevertPortfolioPosition(watch.address as Address, source, state.key);
        if (!validPosition(position, Date.now()) || position.status !== "outside") {
          await this.change(watch, state, interrupt);
          return;
        }
        let continuous: boolean;
        try { continuous = await confirmPortfolioExit(position, state.outsideSince!); }
        catch { throw new Error("链上连续区间核验暂不可用，请检查该网络 RPC 后重试"); }
        if (!continuous) { await this.change(watch, state, interrupt); return; }
        if (!this.active(watch, state)) return;
        await this.change(watch, state, item => { item.verifiedAt = iso(); item.error = undefined; });
        state = this.active(watch, state) ?? state;
      }
      let advice = this.withAdvice ? state.advice : undefined;
      if (this.withAdvice && !advice) {
        await this.change(watch, state, item => { item.delivery = "analyzing"; item.error = undefined; });
        let position: PortfolioPosition;
        try { position = await refreshPortfolioPosition(watch.address, source.id, state.key); }
        catch {
          position = await readRevertPortfolioPosition(watch.address as Address, source, state.key);
          position.notes.push("历史数据暂不可用，本次建议仅依据当前仓位快照。");
        }
        if (!validPosition(position, Date.now()) || position.status !== "outside") {
          await this.change(watch, state, interrupt);
          return;
        }
        if (!this.active(watch, state)) return;
        const result = await analyzePortfolioPosition(position);
        const { provider, action, summary, strategy, trigger, reasons, risks, nextSteps, createdAt, options } = result;
        advice = { provider, action, summary, strategy, trigger, reasons, risks, nextSteps, createdAt, options };
        const stored = await this.change(watch, state, item => { item.advice = advice; item.delivery = "waiting"; });
        if (!stored) return;
      }
      state = this.active(watch, state) ?? state;
      if (!this.active(watch, state)) return;
      const recipient = await getDwsRecipient();
      if (state.deliveryProfile && state.deliveryProfile !== recipient.profile) throw new Error("当前钉钉账号已变化，请切回发送提醒时使用的账号");
      const latest = await readRevertPortfolioPosition(watch.address as Address, source, state.key);
      if (!validPosition(latest, Date.now()) || latest.status !== "outside") {
        await this.change(watch, state, interrupt);
        return;
      }
      if (!this.active(watch, state)) return;
      let continuous: boolean;
      try { continuous = await confirmPortfolioExit(latest, state.outsideSince!); }
      catch { throw new Error("链上连续区间核验暂不可用，请检查该网络 RPC 后重试"); }
      if (!continuous) { await this.change(watch, state, interrupt); return; }
      if (!this.active(watch, state)) return;
      if (state.alerted && Date.now() - Date.parse(state.confirmedAt!) > 86_400_000) throw new Error("发送结果超过幂等有效期，请人工核对钉钉消息");
      let ready = false;
      await this.change(watch, state, item => {
        if (item.status !== "outside" || !item.observedAt || Date.now() - Date.parse(item.observedAt) > MAX_GAP) return;
        item.alerted = true;
        item.deliveryProfile = recipient.profile;
        item.delivery = "sending";
        item.error = undefined;
        ready = true;
      });
      if (!ready) return;
      const result = await sendPortfolioNotification(recipient.profile, recipient.openId, message(latest, state, advice), state.eventId!);
      await this.change(watch, state, item => {
        item.delivery = result.state;
        item.taskId = result.taskId;
        item.error = result.state === "pending" ? "钉钉已受理，等待投递结果" : result.state === "uncertain" ? "钉钉返回结果无法确认，请人工核对" : undefined;
        item.retryAt = result.state === "sent" ? undefined : iso(Date.now() + RETRY);
      });
    } catch (error) {
      await this.change(watch, state, item => {
        item.delivery = item.alerted && !item.taskId ? "uncertain" : "waiting";
        item.error = error instanceof Error ? error.message.slice(0, 180) : "提醒处理失败";
        item.retryAt = iso(Date.now() + RETRY);
      });
    }
  }
}
