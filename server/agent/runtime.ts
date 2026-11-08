import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import type { AgentEvent, AgentState, AgentView, MarketContext, StrategyPlan } from "../../shared/agent.js";
import type { AppData, JsonStore } from "../store.js";
import { marketContext, readPolicy, riskChecks, rulePlan, strategyCandidates } from "./strategy.js";
import { modelConfigured, modelPlan } from "./planner.js";

function agentState(data: AppData): AgentState {
  return data.agent ??= {
    policy: { enabled: true, planner: "rules", cooldownSeconds: 900, maxCostBps: 30, maxPriceDriftBps: 100 },
    events: [], plans: [], observed: {}, lastSimulatedAt: {},
  };
}

function enqueue(state: AgentState, type: AgentEvent["type"], context: MarketContext) {
  if (state.events.filter(e => e.status === "pending" || e.status === "processing").length >= 50) throw new Error("策略队列已满，请稍后重试");
  const event: AgentEvent = { id: randomUUID(), type, createdAt: new Date().toISOString(), context, status: "pending", attempts: 0, trace: [] };
  // shortcut: 仅保留最近 200 条任务，长期审计或多进程部署前需替换为外部事件存储。
  state.events = state.events.filter((e, i, all) => i >= all.length - 199 || e.status === "pending" || e.status === "processing");
  state.events.push(event);
  return event.id;
}

export class StrategyAgent {
  readonly changes = new EventEmitter();
  private processing = false;
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private error?: string;

  constructor(private readonly store: JsonStore) {}

  get view(): AgentView {
    const state = agentState(this.store.snapshot);
    return { policy: state.policy, events: state.events.slice(-50).reverse(), plans: state.plans.slice(-30).reverse(), modelConfigured: modelConfigured(), processing: this.processing, error: this.error };
  }

  async start() {
    await this.update(state => {
      for (const event of state.events) {
        if (event.status === "processing") {
          event.status = event.attempts >= 3 ? "failed" : "pending";
          event.error = event.status === "failed" ? "多次中断，自动恢复已停止；请重新评估仓位" : undefined;
          event.trace.push({ step: "session.recovered", detail: "从持久化任务恢复；不重放任何资金操作", at: new Date().toISOString() });
        }
      }
    });
    await this.observe();
    this.timer = setInterval(() => { void this.observe().catch(() => this.reportError()); }, 5_000);
    this.kick();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  private reportError() {
    this.error = "Agent 状态保存或处理失败，请检查本地数据目录并重启服务";
    this.changes.emit("change");
  }

  private async update(mutator: (state: AgentState, data: AppData) => void) {
    await this.store.update(data => mutator(agentState(data), data));
    this.error = undefined;
    this.changes.emit("change");
  }

  async observe() {
    if (this.stopped || !agentState(this.store.snapshot).policy.enabled) return;
    const snapshot = this.store.snapshot;
    const current = agentState(snapshot);
    const observations = snapshot.positions.map(p => {
      const context = marketContext(p);
      const previous = current.observed[p.id];
      if (previous?.blockNumber && context.blockNumber && BigInt(context.blockNumber) < BigInt(previous.blockNumber)) context.zone = "unavailable";
      const signature = JSON.stringify([context.zone, context.enabled, context.lower, context.upper, context.source]);
      const moved = previous && previous.price > 0 && Math.abs(context.price / previous.price - 1) >= 0.01;
      const type: AgentEvent["type"] = context.zone === "unavailable" ? "data.unavailable" : !previous ? "position.observed" : previous.signature !== signature ? "range.changed" : "price.moved";
      return { context, signature, type, changed: !previous || previous.signature !== signature || moved,
        newBlock: Boolean(context.blockNumber && (!previous?.blockNumber || BigInt(context.blockNumber) > BigInt(previous.blockNumber))) };
    });
    if (!observations.some(o => o.changed || o.newBlock)) return;
    await this.update((state, data) => {
      if (!state.policy.enabled) return;
      for (const observation of observations) {
        const { context, signature, type } = observation;
        const latest = data.positions.find(p => p.id === context.positionId);
        if (!latest || latest.enabled !== context.enabled || latest.priceUpdatedAt !== snapshot.positions.find(p => p.id === context.positionId)?.priceUpdatedAt) continue;
        const previous = state.observed[context.positionId];
        if (!observation.changed || previous?.signature === signature && (context.price === previous.price || previous.price > 0 && Math.abs(context.price / previous.price - 1) < 0.01)) {
          if (previous && observation.newBlock) previous.blockNumber = context.blockNumber;
          continue;
        }
        if (state.events.filter(e => e.status === "pending" || e.status === "processing").length >= 50) break;
        enqueue(state, type, context);
        const blockNumber = previous?.blockNumber && context.blockNumber && BigInt(previous.blockNumber) > BigInt(context.blockNumber) ? previous.blockNumber : context.blockNumber ?? previous?.blockNumber;
        state.observed[context.positionId] = { signature, price: context.price, blockNumber };
      }
      for (const id of Object.keys(state.observed)) {
        if (!data.positions.some(p => p.id === id)) { delete state.observed[id]; delete state.lastSimulatedAt[id]; }
      }
    });
    this.kick();
  }

  async configure(input: unknown) {
    await this.update(state => {
      const next = readPolicy(input, state.policy);
      if (next.planner === "model" && !modelConfigured()) throw new Error("请先配置 AI_GATEWAY_API_KEY 和 LP_AGENT_MODEL");
      state.policy = next;
    });
    await this.observe();
    this.kick();
    return this.view;
  }

  async review(positionId: string) {
    let id = "";
    await this.update((state, data) => {
      if (!state.policy.enabled) throw new Error("请先恢复 Agent");
      const position = data.positions.find(p => p.id === positionId);
      if (!position) throw new Error("仓位不存在");
      const pending = state.events.find(e => e.context.positionId === positionId && ["pending", "processing"].includes(e.status));
      id = pending?.id ?? enqueue(state, "review.requested", marketContext(position));
    });
    this.kick();
    return { eventId: id };
  }

  async demo() {
    let id = "";
    await this.update(state => {
      if (!state.policy.enabled) throw new Error("请先恢复 Agent");
      const pending = state.events.find(e => e.context.demo && ["pending", "processing"].includes(e.status));
      id = pending?.id ?? enqueue(state, "demo.requested", {
        positionId: "demo:eth-usdc", name: "演练 ETH / USDC", source: "synthetic-demo", quoteAsset: "USDC", demo: true,
        enabled: true, price: 3120, lower: 2800, upper: 3100, valueQuote: 10000,
        observedAt: new Date().toISOString(), zone: "outside",
      });
    });
    this.kick();
    return { eventId: id };
  }

  private kick() {
    if (this.processing || this.stopped) return;
    void this.drain().catch(() => this.reportError());
  }

  private async drain() {
    this.processing = true;
    try {
      while (!this.stopped) {
        const state = agentState(this.store.snapshot);
        const event = state.events.find(e => e.status === "pending");
        if (!state.policy.enabled || !event) break;
        await this.update(next => {
          const item = next.events.find(e => e.id === event.id)!;
          item.status = "processing";
          item.attempts++;
          item.trace.push({ step: "event.received", detail: `${event.type} · ${event.context.demo ? "合成演练" : event.context.source}`, at: new Date().toISOString() });
        });
        try {
          const trace = async (step: string, detail: string) => this.update(next => { next.events.find(e => e.id === event.id)!.trace.push({ step, detail, at: new Date().toISOString() }); });
          const checks = riskChecks(event.context, state.policy, state.lastSimulatedAt[event.context.positionId]);
          const useModel = state.policy.planner === "model" && checks.every(c => c.passed);
          const decision = useModel ? await modelPlan(event, state.plans, trace) : rulePlan(event.context);
          await this.update((next, data) => {
            const latest = data.positions.find(p => p.id === event.context.positionId);
            const context = event.context.demo ? event.context : latest ? marketContext(latest) : { ...event.context, enabled: false };
            const finalChecks = riskChecks(context, next.policy, next.lastSimulatedAt[context.positionId]);
            finalChecks.push({ label: "评估期间策略设置未改变", passed: JSON.stringify(state.policy) === JSON.stringify(next.policy) });
            finalChecks.push({ label: "评估期间行情状态和区间未改变", passed: context.zone === event.context.zone && context.lower === event.context.lower && context.upper === event.context.upper && Math.abs(context.price / event.context.price - 1) * 10000 <= next.policy.maxPriceDriftBps });
            const plan: StrategyPlan = {
              id: randomUUID(), eventId: event.id, createdAt: new Date().toISOString(), context: event.context,
              ...decision, planner: useModel ? "model" : "rules", candidates: strategyCandidates(event.context), checks: finalChecks,
              status: finalChecks.some(c => !c.passed) ? "blocked" : decision.action === "hold" ? "observing" : "ready",
            };
            next.plans = [...next.plans.slice(-99), plan];
            const item = next.events.find(e => e.id === event.id)!;
            item.status = "completed";
            item.trace.push({ step: "plan.proposed", detail: `${plan.planner} · ${plan.action}`, at: plan.createdAt });
            item.trace.push({ step: "risk.checked", detail: plan.status === "blocked" ? finalChecks.filter(c => !c.passed).map(c => c.label).join("；") : "初步风控通过；模拟前仍需校验成本和最新行情", at: plan.createdAt });
          });
        } catch (error) {
          await this.update(next => {
            const item = next.events.find(e => e.id === event.id)!;
            item.status = "failed";
            item.error = error instanceof Error && /^(模型|请先)/.test(error.message) ? error.message : "分析失败或超时，请重新评估；未执行任何资金操作";
          });
        }
      }
    } finally {
      this.processing = false;
      this.changes.emit("change");
    }
  }

  async simulate(planId: string, input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("请提供模拟成本假设");
    const record = input as Record<string, unknown>;
    const gasQuote = record.gasQuote;
    const slippageBps = record.slippageBps;
    if (Object.keys(record).length !== 2 || typeof gasQuote !== "number" || !Number.isFinite(gasQuote) || gasQuote < 0 || typeof slippageBps !== "number" || !Number.isFinite(slippageBps) || slippageBps < 0 || slippageBps > 500) throw new Error("Gas 需为非负报价币金额，滑点假设需在 0–500 bps 之间");
    let result: StrategyPlan | undefined;
    await this.update((state, data) => {
      const plan = state.plans.find(p => p.id === planId);
      if (!plan) throw new Error("策略计划不存在或已过保留期限");
      if (plan.status === "simulated") { result = structuredClone(plan); return; }
      if (plan.status !== "ready") throw new Error("仅可模拟已通过风控的行动计划，请重新评估");
      const position = data.positions.find(p => p.id === plan.context.positionId);
      const context = plan.context.demo ? plan.context : position ? marketContext(position) : undefined;
      if (!context) throw new Error("仓位已删除，请重新评估");
      const checks = riskChecks(context, state.policy, state.lastSimulatedAt[context.positionId]);
      const watermark = state.observed[context.positionId]?.blockNumber;
      if (watermark && context.blockNumber && BigInt(context.blockNumber) < BigInt(watermark)) throw new Error("链上区块发生回退，请等待新快照并重新评估");
      const failures = checks.filter(c => !c.passed);
      if (failures.length) throw new Error(`${failures.map(c => c.label).join("；")}，请重新评估`);
      if (Date.now() - Date.parse(plan.createdAt) > 120_000 || context.lower !== plan.context.lower || context.upper !== plan.context.upper || context.zone !== plan.context.zone || context.blockNumber && plan.context.blockNumber && BigInt(context.blockNumber) < BigInt(plan.context.blockNumber)
        || Math.abs(context.price / plan.context.price - 1) * 10000 > state.policy.maxPriceDriftBps) throw new Error("计划已过期或行情发生变化，请重新评估");
      const estimatedCostQuote = gasQuote + context.valueQuote * slippageBps / 10000;
      const costBps = estimatedCostQuote / context.valueQuote * 10000;
      if (!Number.isFinite(costBps) || costBps > state.policy.maxCostBps) throw new Error(`模拟成本超过 ${state.policy.maxCostBps} bps 风控上限`);
      const at = new Date().toISOString();
      plan.status = "simulated";
      plan.simulation = {
        at, price: context.price, gasQuote, slippageBps, estimatedCostQuote,
        valueAfterCostsQuote: context.valueQuote - estimatedCostQuote,
        reflection: `在输入成本假设下，本次操作消耗本金约 ${costBps.toFixed(2)} bps。后续至少需赚回这些成本才可能抵消调仓支出；未计未来手续费、无常损失、MEV 或真实成交。`,
      };
      state.lastSimulatedAt[context.positionId] = at;
      const event = state.events.find(e => e.id === plan.eventId);
      event?.trace.push({ step: "paper.executed", detail: `模拟成本 ${estimatedCostQuote.toFixed(6)} ${context.quoteAsset}；没有链上交易`, at });
      event?.trace.push({ step: "memory.updated", detail: plan.simulation.reflection, at });
      result = structuredClone(plan);
    });
    return result!;
  }
}
