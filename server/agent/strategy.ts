import type { AgentPolicy, MarketContext, StrategyAction, StrategyCandidate } from "../../shared/agent.js";
import type { Position } from "../domain/position.js";

export const MAX_AGE_MS = 30_000;

export function marketContext(position: Position, now = Date.now()): MarketContext {
  const snapshot = position.chainSnapshot;
  const price = position.currentPrice ?? 0;
  const observedAt = snapshot?.updatedAt ?? position.priceUpdatedAt ?? "";
  const age = now - Date.parse(observedAt);
  const market = snapshot?.market;
  const valid = position.enabled && !position.priceReadFailed && Number.isFinite(price) && price > 0
    && Number.isFinite(age) && age >= -5_000 && age <= MAX_AGE_MS
    && position.lowerPrice > 0 && position.upperPrice > position.lowerPrice
    && (!position.source || Boolean(snapshot && market));
  const outside = market
    ? market.currentTick < market.tickLower || market.currentTick >= market.tickUpper
    : price < position.lowerPrice || price >= position.upperPrice;
  return {
    positionId: position.id, name: position.name, source: position.source?.type ?? "historical-simulation",
    quoteAsset: position.quoteAsset, demo: false, enabled: position.enabled, price,
    lower: position.lowerPrice, upper: position.upperPrice,
    valueQuote: snapshot?.principalValueQuote ?? position.simulation?.valueQuote ?? 0,
    observedAt, blockNumber: snapshot?.blockNumber,
    zone: !valid ? "unavailable" : outside ? "outside"
      : price <= position.alertLower || price >= position.alertUpper ? "edge" : "safe",
  };
}

export function strategyCandidates(context: MarketContext): StrategyCandidate[] {
  const halfWidth = Math.min(0.4, Math.max(0.02, (context.upper - context.lower) / (context.upper + context.lower)));
  return [
    { action: "hold", title: "继续观察", tradeoff: "不产生调仓成本；区间外不赚取交易手续费。" },
    { action: "recenter", title: "重新居中", tradeoff: "按原区间相对宽度估算新范围；涉及移除、换币和建仓，尚未对齐 tick。",
      lower: context.price * (1 - halfWidth), upper: context.price * (1 + halfWidth) },
    { action: "reduce", title: "移除流动性", tradeoff: "停止提供流动性并保留双币资产；不等同于换成稳定币或消除价格风险。" },
  ];
}

export function rulePlan(context: MarketContext): { action: StrategyAction; reason: string } {
  if (context.zone === "outside") return { action: "recenter", reason: "价格已离开有效区间。建议先比较重新居中的成本与继续等待的取舍；不预测回归时间或未来收益。" };
  if (context.zone === "edge") return { action: "hold", reason: "价格接近边界但仍在区间内，暂不频繁追价；等待越界或新的价格事件。" };
  if (context.zone === "unavailable") return { action: "hold", reason: "仓位暂停、数据缺失、过期或读取异常，停止生成可执行建议。" };
  return { action: "hold", reason: "价格处于安全区间，保留现有仓位并等待下一次事件。" };
}

export function riskChecks(context: MarketContext, policy: AgentPolicy, lastSimulatedAt?: string, now = Date.now()) {
  const age = now - Date.parse(context.observedAt);
  return [
    { label: "Agent 和仓位已启用", passed: policy.enabled && context.enabled },
    { label: "行情可用且不超过 30 秒", passed: context.zone !== "unavailable" && Number.isFinite(age) && age >= -5_000 && age <= MAX_AGE_MS },
    { label: "价格、区间和本金有效", passed: [context.price, context.lower, context.upper, context.valueQuote].every(v => Number.isFinite(v) && v > 0) && context.lower < context.upper },
    { label: "已通过模拟操作冷却期", passed: !lastSimulatedAt || now - Date.parse(lastSimulatedAt) >= policy.cooldownSeconds * 1_000 },
  ];
}

export function readPolicy(input: unknown, current: AgentPolicy): AgentPolicy {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("策略设置格式无效");
  const record = input as Record<string, unknown>;
  const allowed = Object.keys(current);
  if (!Object.keys(record).length || Object.keys(record).some(key => !allowed.includes(key))) throw new Error("包含不支持的策略设置");
  const next = { ...current, ...record } as AgentPolicy;
  if (typeof next.enabled !== "boolean" || !["rules", "model"].includes(next.planner)) throw new Error("策略模式无效");
  for (const [value, min, max] of [[next.cooldownSeconds, 60, 86400], [next.maxCostBps, 1, 500], [next.maxPriceDriftBps, 1, 1000]]) {
    if (!Number.isInteger(value) || value < min || value > max) throw new Error("冷却期需为 60–86400 秒，成本上限为 1–500 bps，价格偏移上限为 1–1000 bps");
  }
  return next;
}
