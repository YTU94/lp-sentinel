import { simulateConcentratedPosition } from "../domain/lp-math.js";
import { rulePlan, strategyCandidates } from "../agent/strategy.js";
import type { MarketContext } from "../../shared/agent.js";
import type { Bar, Pool } from "./data.js";

export interface Parameters { widthMultiplier: number; confirmationHours: number; cooldownHours: number; costCoverage: number }
export interface Scenario { name: string; feeFactor: number; gasQuote: number; slippageBps: number }
export const SCENARIOS: Scenario[] = [
  { name: "estimated-fees", feeFactor: 1, gasQuote: 5, slippageBps: 5 },
  { name: "half-fees", feeFactor: 0.5, gasQuote: 5, slippageBps: 5 },
  { name: "zero-fees", feeFactor: 0, gasQuote: 5, slippageBps: 5 },
  { name: "higher-cost", feeFactor: 0.5, gasQuote: 15, slippageBps: 10 },
];
export const CAPITAL = 10_000;
export type Strategy = "static" | "current" | "adaptive" | "hodl";
interface Range { lower: number; upper: number; tickLower: number; tickUpper: number }
interface Position { capital: number; reference: number; range: Range; liquidity: number }
interface Pending { range: Range; price: number; reason: string }
export interface Replay {
  strategy: Strategy; returnPct: number; maxDrawdownPct: number; finalValueQuote: number;
  feesQuote: number; costsQuote: number; rebalances: number; cancelled: number; fullRangeHours: number;
  hours: number; maxLiquidityShare: number; decisions: Record<string, number>;
  dailyReturns: number[]; nav: number[];
  trades: { time: number; price: number; cost: number; reason: string; range: Range }[];
}

function rangeAt(pool: Pool, price: number, width: number): Range {
  const scale = 10 ** (pool.decimals - 6);
  const tickLower = Math.floor(Math.log(scale / (price * (1 + width))) / Math.log(1.0001) / pool.spacing) * pool.spacing;
  const tickUpper = Math.ceil(Math.log(scale / (price * (1 - width))) / Math.log(1.0001) / pool.spacing) * pool.spacing;
  if (tickLower < -887272 || tickUpper > 887272 || tickLower >= tickUpper) throw new Error("价格超出 V3 tick 范围");
  return { lower: scale / 1.0001 ** tickUpper, upper: scale / 1.0001 ** tickLower, tickLower, tickUpper };
}
function liquidity(pool: Pool, price: number, range: Range, capital: number) {
  const scale = 10 ** (pool.decimals - 6);
  const sqrtLower = Math.sqrt(scale / range.upper), sqrtUpper = Math.sqrt(scale / range.lower);
  const sqrtPrice = Math.max(sqrtLower, Math.min(sqrtUpper, Math.sqrt(scale / price)));
  const quotePerL = (sqrtUpper - sqrtPrice) / (sqrtPrice * sqrtUpper) / 1e6;
  const basePerL = (sqrtPrice - sqrtLower) / 10 ** pool.decimals;
  return capital / (quotePerL + basePerL * price);
}
function mark(position: Position, price: number) {
  return simulateConcentratedPosition({ capitalQuote: position.capital, currentPrice: price,
    referencePrice: position.reference, lowerPrice: position.range.lower, upperPrice: position.range.upper });
}
// Price is inverse to the pool's raw ratio: tickLower is inclusive, tickUpper is exclusive.
const inside = (price: number, range: Range) => price > range.lower && price <= range.upper;
const costAt = (value: number, scenario: Scenario) => scenario.gasQuote + value * scenario.slippageBps / 10_000;
function drawdown(nav: number[]) {
  let peak = nav[0], worst = 0;
  for (const value of nav) { peak = Math.max(peak, value); worst = Math.max(worst, (peak - value) / peak); }
  return worst * 100;
}
export function dailyReturns(nav: number[]) {
  const days: number[] = [];
  for (let i = 24; i < nav.length; i += 24) days.push(nav[i] / nav[i - 24] - 1);
  return days;
}

function choose(pool: Pool, history: Bar[], position: Position, strategy: Strategy,
  parameters: Parameters | null, outsideHours: number, hoursSinceTrade: number, scenario: Scenario): { pending?: Pending; reason: string } {
  const bar = history[history.length - 1];
  if (inside(bar.close, position.range)) return { reason: "inside-range" };
  if (strategy === "static" || !parameters && strategy === "adaptive") return { reason: "static-policy" };
  if (strategy === "current") {
    const context: MarketContext = { positionId: pool.id, name: pool.name, source: "ethereum-uniswap-v3-replay",
      quoteAsset: "USDC", demo: true, enabled: true, price: bar.close,
      lower: position.range.lower, upper: position.range.upper, valueQuote: mark(position, bar.close).valueQuote,
      observedAt: new Date((bar.time + 3600) * 1000).toISOString(), zone: "outside" };
    const candidate = strategyCandidates(context).find(c => c.action === rulePlan(context).action);
    if (!candidate?.lower || !candidate.upper) return { reason: "current-hold" };
    const width = (candidate.upper - candidate.lower) / (candidate.upper + candidate.lower);
    return { pending: { range: rangeAt(pool, bar.close, width), price: bar.close, reason: "current-outside" }, reason: "current-outside" };
  }
  if (!parameters) throw new Error("自适应参数缺失");
  if (outsideHours < parameters.confirmationHours) return { reason: "wait-confirmation" };
  if (hoursSinceTrade < parameters.cooldownHours) return { reason: "cooldown" };
  if (history.length < 25) return { reason: "warmup" };
  const recent = history.slice(-25);
  const returns = recent.slice(1).map((b, i) => Math.log(b.close / recent[i].close));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const volatility = Math.sqrt(returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length);
  const width = Math.max(pool.stable ? 0.0005 : 0.005,
    Math.min(pool.stable ? 0.02 : 0.2, volatility * Math.sqrt(24) * parameters.widthMultiplier));
  const range = rangeAt(pool, bar.close, width);
  const value = mark(position, bar.close).valueQuote;
  const cost = costAt(value, scenario);
  if (cost / value > 0.003) return { reason: "cost-cap" };
  const ownLiquidity = liquidity(pool, bar.close, range, value - cost);
  // shortcut: past hourly fees and end-hour liquidity only approximate payback; upgrade with swap/tick replay before live use.
  const expectedFees = recent.slice(1).reduce((sum, h) => sum + h.feesQuote * ownLiquidity / (h.liquidity + ownLiquidity), 0) * 0.5;
  if (expectedFees < cost * parameters.costCoverage) return { reason: "fees-below-cost" };
  return { pending: { range, price: bar.close, reason: "confirmed-outside-cost-covered" }, reason: "confirmed-outside-cost-covered" };
}

export function replay(pool: Pool, bars: Bar[], from: number, to: number, strategy: Strategy,
  parameters: Parameters | null, scenario: Scenario): Replay {
  if (from < 25 || to > bars.length || to <= from || from % 24 || to % 24) throw new Error("回放需要预热及完整 UTC 日窗口");
  if (![scenario.gasQuote, scenario.slippageBps, scenario.feeFactor].every(v => Number.isFinite(v) && v >= 0)
    || scenario.feeFactor > 1 || scenario.slippageBps > 500 || scenario.gasQuote >= CAPITAL / 2) throw new Error("成本场景无效");
  if (parameters && (!Number.isFinite(parameters.widthMultiplier) || parameters.widthMultiplier <= 0
    || !Number.isInteger(parameters.confirmationHours) || parameters.confirmationHours < 1
    || !Number.isInteger(parameters.cooldownHours) || parameters.cooldownHours < 1
    || !Number.isFinite(parameters.costCoverage) || parameters.costCoverage < 1)) throw new Error("自适应参数无效");
  const first = bars[from];
  const range = rangeAt(pool, first.open, pool.stable ? 0.001 : 0.05);
  const entryCost = strategy === "hodl" ? 0 : costAt(CAPITAL, scenario);
  let position: Position = { capital: CAPITAL - entryCost, reference: first.open, range,
    liquidity: liquidity(pool, first.open, range, CAPITAL - entryCost) };
  const basket = mark({ ...position, capital: CAPITAL }, first.open);
  let fees = 0, costs = entryCost, outsideHours = 0, lastTrade = from, pending: Pending | undefined;
  let fullRangeHours = 0, maxLiquidityShare = 0, cancelled = 0;
  const nav = [CAPITAL], trades: Replay["trades"] = [], decisions: Record<string, number> = {};
  for (let i = from; i < to; i++) {
    const bar = bars[i];
    if (strategy === "hodl") { nav.push(basket.baseAmount * bar.close + basket.quoteAmount); continue; }
    if (pending) {
      const value = mark(position, bar.open).valueQuote;
      const cost = costAt(value, scenario);
      const nextLiquidity = liquidity(pool, bar.open, pending.range, Math.max(0, value - cost));
      if (!inside(bar.open, position.range) && inside(bar.open, pending.range)
        && Math.abs(bar.open / pending.price - 1) <= 0.01 && cost / value <= 0.003
        && nextLiquidity / (bars[i - 1].liquidity + nextLiquidity) <= 0.01 && value > cost) {
        position = { capital: value - cost, reference: bar.open, range: pending.range, liquidity: nextLiquidity };
        costs += cost; lastTrade = i; outsideHours = 0;
        trades.push({ time: bar.time, price: bar.open, cost, reason: pending.reason, range: pending.range });
      } else { cancelled++; }
      pending = undefined;
    }
    const overlapsRange = bar.high > position.range.lower && bar.low <= position.range.upper;
    const share = overlapsRange ? position.liquidity / (bar.liquidity + position.liquidity) : 0;
    maxLiquidityShare = Math.max(maxLiquidityShare, share);
    if (share > 0.01) throw new Error(`${pool.name} 模拟仓位超过活跃流动性的 1%，小资金近似不适用`);
    if (bar.low > position.range.lower && bar.high <= position.range.upper) {
      fullRangeHours++;
      // shortcut: cash-valued fees, end-hour active liquidity, no intra-hour attribution; use fee haircuts and zero-fee stress.
      fees += bar.feesQuote * share * scenario.feeFactor;
    }
    const value = mark(position, bar.close).valueQuote + fees;
    const exitCost = i === to - 1 ? scenario.gasQuote : 0;
    costs += exitCost;
    if (!Number.isFinite(value) || value <= exitCost) throw new Error("模拟资不抵债或估值异常，拒绝输出收益指标");
    nav.push(value - exitCost);
    outsideHours = inside(bar.close, position.range) ? 0 : outsideHours + 1;
    if (i < to - 1) {
      const decision = choose(pool, bars.slice(Math.max(0, i - 24), i + 1), position, strategy,
        parameters, outsideHours, i - lastTrade, scenario);
      decisions[decision.reason] = (decisions[decision.reason] ?? 0) + 1;
      pending = decision.pending;
    }
  }
  const finalValueQuote = nav[nav.length - 1];
  return { strategy, returnPct: (finalValueQuote / CAPITAL - 1) * 100, maxDrawdownPct: drawdown(nav),
    finalValueQuote, feesQuote: fees, costsQuote: costs, rebalances: trades.length, cancelled, fullRangeHours,
    hours: to - from, maxLiquidityShare, decisions, dailyReturns: dailyReturns(nav), nav, trades };
}

export function compareDaily(candidate: number[], benchmark: number[]) {
  if (!candidate.length || candidate.length !== benchmark.length) throw new Error("比较窗口不一致");
  let wins = 0, ties = 0;
  candidate.forEach((value, i) => { if (value - benchmark[i] > 1e-9) wins++; else if (Math.abs(value - benchmark[i]) <= 1e-9) ties++; });
  return { wins, ties, losses: candidate.length - wins - ties, windows: candidate.length,
    winRate: wins / candidate.length, positiveDays: candidate.filter(v => v > 1e-9).length };
}

export const CANDIDATES: Parameters[] = [1.5, 2.5, 4].flatMap(widthMultiplier =>
  [2, 4].flatMap(confirmationHours => [6, 12].flatMap(cooldownHours =>
    [2, 4].map(costCoverage => ({ widthMultiplier, confirmationHours, cooldownHours, costCoverage })))));
