import { useEffect, useState } from "react";
import { Activity, ArrowRight, Check, CircleAlert, FlaskConical, Pause, Play, RefreshCw } from "lucide-react";
import { api } from "./api";
import type { Position } from "./types";
import type { AgentView, StrategyPlan } from "../shared/agent";
import "./agent-panel.css";

const statuses = { observing: "持续观察", ready: "待模拟", blocked: "风控拦截", simulated: "已模拟" };
const actions = { hold: "继续观察", recenter: "重新居中", reduce: "移除流动性" };
const eventNames = { "position.observed": "首次观察", "range.changed": "区间状态变化", "price.moved": "价格变动 ≥ 1%", "data.unavailable": "数据不可用", "review.requested": "手动评估", "demo.requested": "合成行情演练" };
const eventStatuses = { pending: "排队中", processing: "分析中", completed: "已完成", failed: "失败" };
const steps: Record<string, string> = { "event.received": "感知事件", "tool.called": "读取工具", "context.prepared": "准备只读数据", "plan.proposed": "提出建议", "risk.checked": "风控校验", "paper.executed": "模拟执行", "memory.updated": "复盘入库", "session.recovered": "恢复任务" };
const number = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(value);
const time = (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false });

export function AgentPanel({ positions }: { positions: Position[] }) {
  const [view, setView] = useState<AgentView>();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [positionId, setPositionId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [pendingEventId, setPendingEventId] = useState("");
  const [costs, setCosts] = useState({ gas: "", slippage: "" });

  useEffect(() => {
    let active = true;
    let receivedStream = false;
    void api.agent().then(data => { if (active) { setView(current => current ?? data); setLoadError(""); } }).catch(() => { if (active && !receivedStream) setLoadError("无法读取 Agent，请确认本地服务已启动。"); });
    const stream = new EventSource("/api/agent/stream");
    stream.addEventListener("state", event => {
      try { setView(JSON.parse((event as MessageEvent).data)); receivedStream = true; setConnected(true); setLoadError(""); }
      catch { setConnected(false); }
    });
    stream.onerror = () => setConnected(false);
    return () => { active = false; stream.close(); };
  }, []);

  useEffect(() => {
    if (!view) return;
    const requested = view.plans.find(p => p.eventId === pendingEventId);
    const current = view.plans.find(p => p.id === selectedId);
    const next = requested ?? current ?? view.plans[0];
    if (next && next.id !== selectedId) {
      setSelectedId(next.id);
      setCosts(next.context.demo ? { gas: "1", slippage: "10" } : { gas: "", slippage: "" });
    }
    if (requested || view.events.some(e => e.id === pendingEventId && e.status === "failed")) setPendingEventId("");
  }, [view, selectedId, pendingEventId]);

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await operation(); setView(await api.agent()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败，请重试"); }
    finally { setBusy(false); }
  };
  const plan = view?.plans.find(p => p.id === selectedId);
  const activeEvent = view?.events.find(e => e.id === plan?.eventId);

  return <div className="agent-workspace">
    <header className="agent-heading">
      <div><h1>LP 策略 Agent</h1><p>行情触发判断，每一次行动都有依据。</p></div>
      <div className="agent-connection"><span className={`pulse ${connected ? "online" : "offline"}`} />{connected ? "事件流已连接" : "正在连接事件流"}</div>
    </header>
    <div className="agent-flow" aria-label="策略处理流程">
      {["感知事件", "分析策略", "独立风控", "模拟执行", "复盘记忆"].map((label, index) => <span key={label}>{index > 0 && <ArrowRight size={14} aria-hidden="true" />}{label}</span>)}
    </div>
    <div className="agent-toolbar">
      <div><strong>{view?.policy.planner === "model" ? "模型模式" : "规则模式"}</strong><span> · {view?.policy.enabled ? view.processing ? "正在分析" : "等待事件" : "已暂停"} · 仅模拟资金操作</span></div>
      <button className="wallet-button" disabled={busy || !view} onClick={() => void run(() => api.agentPolicy({ enabled: !view!.policy.enabled }))}>{view?.policy.enabled ? <Pause size={15} /> : <Play size={15} />}{view?.policy.enabled ? "暂停 Agent" : "恢复 Agent"}</button>
    </div>
    {(error || loadError || view?.error) && <div className="agent-error" role="alert"><CircleAlert size={17} /><span>{error || loadError || view?.error}</span></div>}
    {!view && <p role="status">正在读取策略会话…</p>}
    <section className="agent-launch" aria-label="开始评估">
      <form onSubmit={event => { event.preventDefault(); void run(async () => { const result = await api.agentReview(positionId); setPendingEventId(result.eventId); }); }}>
        <label htmlFor="agent-position">评估监控仓位</label>
        <div className="agent-input-row"><select id="agent-position" value={positionId} onChange={event => setPositionId(event.target.value)}><option value="">{positions.length ? "选择一个 LP 仓位" : "暂无可用的本地监控记录"}</option>{positions.map(p => <option key={p.id} value={p.id}>{p.name}{p.enabled ? "" : "（已暂停）"}</option>)}</select><button className="primary-button" disabled={busy || !positionId || !view?.policy.enabled}><RefreshCw size={15} />评估</button></div>
      </form>
      <div className="agent-demo"><button className="wallet-button" disabled={busy || !view?.policy.enabled} onClick={() => void run(async () => { const result = await api.agentDemo(); setPendingEventId(result.eventId); })}><FlaskConical size={16} />运行越界演练</button><small>合成 ETH / USDC 行情，独立于真实仓位。</small></div>
    </section>

    <div className="agent-columns">
      <section className="agent-decisions" aria-labelledby="agent-decisions-title">
        <div className="agent-section-heading"><h2 id="agent-decisions-title">策略决策</h2><span>最近 {view?.plans.length ?? 0} 条</span></div>
        {!plan ? <div className="agent-empty"><Activity size={28} /><h3>等待第一个策略事件</h3><p>既有本地记录会持续观察区间变化，也可以运行一次越界演练，查看判断、风控与模拟结果。</p></div> : <>
          <label className="agent-history-label" htmlFor="agent-history">选择决策记录</label>
          <select id="agent-history" className="agent-history" value={plan.id} onChange={event => { setSelectedId(event.target.value); setPendingEventId(""); setCosts({ gas: "", slippage: "" }); setError(""); }}>{view!.plans.map(p => <option key={p.id} value={p.id}>{p.context.demo ? "[演练] " : ""}{p.context.name} · {actions[p.action]} · {time(p.createdAt)}</option>)}</select>
          <div className="agent-plan-title"><h3>{actions[plan.action]}</h3><span className={`agent-status ${plan.status}`}>{statuses[plan.status]}</span></div>
          <p className="agent-reason">{plan.reason}</p>
          <p className="agent-meta">{plan.context.demo ? "合成演练数据" : plan.context.source} · {plan.planner === "rules" ? "规则判断" : "模型分析"} · {time(plan.createdAt)}</p>
          <dl className="agent-market"><div><dt>快照价格</dt><dd>{number(plan.context.price)} {plan.context.quoteAsset}</dd></div><div><dt>原 LP 区间</dt><dd>{number(plan.context.lower)} — {number(plan.context.upper)}</dd></div><div><dt>快照本金</dt><dd>{number(plan.context.valueQuote)} {plan.context.quoteAsset}</dd></div></dl>
          <details className="agent-alternatives"><summary>查看策略比较</summary>{plan.candidates.map(candidate => <div key={candidate.action}><strong>{candidate.title}</strong><p>{candidate.tradeoff}</p>{candidate.lower !== undefined && <p>参考范围 {number(candidate.lower)} — {number(candidate.upper!)} {plan.context.quoteAsset}，仅供分析。</p>}</div>)}</details>
          <h4>风控检查</h4><ul className="agent-checks">{plan.checks.map(check => <li key={check.label} className={check.passed ? "passed" : "failed"}>{check.passed ? <Check size={15} aria-hidden="true" /> : <CircleAlert size={15} aria-hidden="true" />}<span>{check.passed ? "通过" : "未通过"} · {check.label}</span></li>)}</ul>
          {plan.status === "ready" && <form className="agent-simulation" onSubmit={event => { event.preventDefault(); void run(() => api.agentSimulate(plan.id, Number(costs.gas), Number(costs.slippage))); }}>
            <h4>填写模拟成本假设</h4><p>成本由你输入，不是实时链上报价。提交时重新校验最新行情；快照超过 30 秒需重新评估。</p>
            <div className="agent-cost-inputs"><label>Gas（{plan.context.quoteAsset}）<input type="number" min="0" step="any" required value={costs.gas} placeholder="例如 1" onChange={event => setCosts({ ...costs, gas: event.target.value })} /></label><label>滑点假设（bps）<input type="number" min="0" max="500" step="any" required value={costs.slippage} placeholder="例如 10" onChange={event => setCosts({ ...costs, slippage: event.target.value })} /></label></div>
            <button className="primary-button" disabled={busy || !view?.policy.enabled || Boolean(pendingEventId)}><FlaskConical size={16} />{pendingEventId ? "等待本次评估" : "模拟这次操作"}</button>
          </form>}
          {plan.simulation && <SimulationResult plan={plan} />}
          {plan.status === "blocked" && <p className="agent-hint">解决未通过项后，重新评估仓位以生成新计划。</p>}
        </>}
      </section>
      <aside className="agent-journal" aria-label="事件与决策轨迹">
        <div className="agent-section-heading"><h2>事件记录</h2><span>持久化会话</span></div>
        {view?.events.length ? <ol className="agent-event-list">{view.events.slice(0, 10).map(event => <li key={event.id}><div><strong>{eventNames[event.type]}</strong><span>{eventStatuses[event.status]}</span></div><p>{event.context.name}</p><time dateTime={event.createdAt}>{time(event.createdAt)}</time>{event.error && <p className="agent-failure">{event.error}</p>}</li>)}</ol> : <p className="agent-hint">行情事件到来后，会在这里留下记录。</p>}
        {activeEvent && <><h3>本次决策轨迹</h3><ol className="agent-trace">{activeEvent.trace.map((entry, index) => <li key={`${entry.step}-${index}`}><strong>{steps[entry.step] ?? entry.step}</strong><p>{entry.detail}</p></li>)}</ol></>}
      </aside>
    </div>
    {view && <details className="agent-settings"><summary>策略设置与执行边界</summary><form key={JSON.stringify(view.policy)} onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      void run(() => api.agentPolicy({ planner: data.get("planner") as "rules" | "model", cooldownSeconds: Number(data.get("cooldown")) * 60, maxCostBps: Number(data.get("cost")), maxPriceDriftBps: Number(data.get("drift")) }));
    }}><div className="agent-policy-inputs"><label>分析方式<select name="planner" defaultValue={view.policy.planner}><option value="rules">规则模式</option><option value="model" disabled={!view.modelConfigured}>模型模式{view.modelConfigured ? "" : "（未配置）"}</option></select></label><label>冷却时间（分钟）<input name="cooldown" type="number" min="1" max="1440" step="1" required defaultValue={view.policy.cooldownSeconds / 60} /></label><label>成本上限（bps）<input name="cost" type="number" min="1" max="500" required defaultValue={view.policy.maxCostBps} /></label><label>价格偏移上限（bps）<input name="drift" type="number" min="1" max="1000" required defaultValue={view.policy.maxPriceDriftBps} /></label></div><p>模型模式会将行情、策略选项和近期决策发送给配置的模型服务，不发送钱包地址或凭据。规则模式在本地分析。</p><p>所有资金操作仅作成本演练，不签名、不广播、不改变原有 LP。参考区间尚未对齐 tick，也不包含成交保证。</p><button className="wallet-button" disabled={busy}>保存策略设置</button></form></details>}
  </div>;
}

function SimulationResult({ plan }: { plan: StrategyPlan }) {
  const simulation = plan.simulation!;
  return <section className="agent-result" aria-label="模拟结果"><h4>模拟完成 · 已写入决策记忆</h4><dl><div><dt>估算操作成本</dt><dd>{number(simulation.estimatedCostQuote)} {plan.context.quoteAsset}</dd></div><div><dt>扣除成本后的参考本金</dt><dd>{number(simulation.valueAfterCostsQuote)} {plan.context.quoteAsset}</dd></div></dl><p>{simulation.reflection}</p></section>;
}
