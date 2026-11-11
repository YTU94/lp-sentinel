import { useEffect, useState } from "react";
import { ChevronRight, CircleAlert, LoaderCircle, Radar } from "lucide-react";
import type { EvaluationReport } from "../shared/evaluation";
import { api } from "./api";
import "./agent-evaluation.css";

function RadarChart({ dimensions }: { dimensions: EvaluationReport["dimensions"] }) {
  const centerX = 210, centerY = 160, radius = 105;
  const point = (index: number, amount: number) => {
    const angle = -Math.PI / 2 + 2 * Math.PI * index / dimensions.length;
    return [centerX + Math.cos(angle) * radius * amount, centerY + Math.sin(angle) * radius * amount] as const;
  };
  const polygon = (amount: number) => dimensions.map((_, index) => point(index, amount).join(",")).join(" ");
  const allScored = dimensions.every(item => item.score !== null);
  const scorePoints = dimensions.map((item, index) => point(index, (item.score ?? 0) / 100).join(",")).join(" ");
  return <svg className="evaluation-radar" viewBox="0 0 420 325" role="img" aria-label={`测评雷达图。${dimensions.map(item => `${item.label} ${item.score === null ? "未评分" : `${item.score} 分`}`).join("，")}`}>
    {[0.25, 0.5, 0.75, 1].map(level => <polygon key={level} points={polygon(level)} className="evaluation-grid" />)}
    {dimensions.map((item, index) => {
      const [x, y] = point(index, 1);
      const [labelX, labelY] = point(index, 1.28);
      return <g key={item.id}><line x1={centerX} y1={centerY} x2={x} y2={y} className="evaluation-axis" /><text x={labelX} y={labelY} textAnchor={Math.abs(labelX - centerX) < 8 ? "middle" : labelX > centerX ? "start" : "end"} dominantBaseline="middle">{item.label}</text></g>;
    })}
    {allScored && <polygon points={scorePoints} className="evaluation-shape" />}
    {dimensions.map((item, index) => item.score === null ? null : <circle key={item.id} cx={point(index, item.score / 100)[0]} cy={point(index, item.score / 100)[1]} r="4" className="evaluation-point" />)}
  </svg>;
}

function evidenceText(evidence: string) {
  try {
    const value = JSON.parse(evidence) as { action?: string; summary?: string; strategy?: string; trigger?: string; reasons?: string[]; risks?: string[]; nextSteps?: string[] };
    const action = value.action === "hold" ? "维持" : value.action === "recenter" ? "调整区间" : value.action === "reduce" ? "减少敞口" : value.action;
    return [`${action || "建议"}：${value.summary || ""}`, value.strategy && `策略：${value.strategy}`, value.trigger && `条件：${value.trigger}`, value.reasons?.length && `依据：${value.reasons.join("；")}`, value.risks?.length && `风险：${value.risks.join("；")}`, value.nextSteps?.length && `下一步：${value.nextSteps.join("；")}`].filter(Boolean).join("\n");
  } catch { return evidence; }
}

export function AgentEvaluation() {
  const [report, setReport] = useState<EvaluationReport | null>(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    try { const result = await api.agentEvaluation(); setReport(result.report); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取测评状态"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (report?.state !== "running") return;
    let active = true;
    let timer: number;
    const poll = async () => {
      try {
        const result = await api.agentEvaluation();
        if (active) { setReport(result.report); setError(""); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "无法读取测评状态");
      } finally {
        if (active) timer = window.setTimeout(() => void poll(), 2500);
      }
    };
    timer = window.setTimeout(() => void poll(), 2500);
    return () => { active = false; window.clearTimeout(timer); };
  }, [report?.state]);
  const start = async () => {
    setStarting(true); setError("");
    try { const result = await api.startAgentEvaluation(); setReport(result.report); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "无法启动测评"); }
    finally { setStarting(false); }
  };
  const running = report?.state === "running" || starting;
  const incomplete = report?.cases.filter(item => item.status === "incomplete").length ?? 0;
  const failed = report?.cases.filter(item => item.status === "failed").length ?? 0;
  return <section className="agent-evaluation" aria-labelledby="agent-evaluation-title">
    <div className="evaluation-heading">
      <div><h2 id="agent-evaluation-title"><Radar size={17} />Agent 一键测评</h2><p>按当前策略定义生成合成场景，评估建议质量与事件风控。</p></div>
      <button className="wallet-button" type="button" disabled={running || loading} onClick={() => void start()}>{running ? <LoaderCircle size={15} className="spin" /> : <Radar size={15} />}{running ? "测评进行中" : report ? "重新测评" : "开始测评"}</button>
    </div>
    <p className="evaluation-note">测评固定使用本机 Codex，与当前选择的模型无关；将多次运行并可能消耗正常额度。合成数据不涉及真实钱包、通知或交易。</p>
    {loading && <p className="evaluation-status" role="status">正在读取测评状态…</p>}
    {error && <p className="portfolio-error" role="alert"><CircleAlert size={15} />{error}</p>}
    {report?.state === "running" && <p className="evaluation-status" role="status">正在测评 {report.completed} / {report.total} 个场景，结果会自动更新。</p>}
    {(report?.state === "failed" || report?.state === "interrupted") && <p className="portfolio-error" role="alert"><CircleAlert size={15} />{report.error || "测评未完成，请重试。"}</p>}
    {report && <details className="evaluation-plan"><summary>测评方案 · {report.plan.length} 个场景 · {report.framework}</summary>
      <p>依据当前策略指令、输出约束和风控参数生成；事件场景使用规则模式。定义指纹 {report.definitionHash.slice(0, 12)}。</p>
      <ul>{report.plan.map(item => <li key={item.id}><strong>{item.title}</strong><span>{item.target} · {item.purpose}</span></li>)}</ul>
      <p>事件模拟参数：冷却 {report.policy.cooldownSeconds} 秒、成本上限 {report.policy.maxCostBps} bps、价格偏移上限 {report.policy.maxPriceDriftBps} bps。</p>
    </details>}
    {report?.state === "completed" && <div className="evaluation-result" aria-live="polite">
      <div className="evaluation-result-heading"><div><h3>本次测评结果</h3><p>{report.finishedAt ? new Date(report.finishedAt).toLocaleString("zh-CN", { hour12: false }) : ""} · {report.cases.length - failed - incomplete} 个通过 · {failed} 个未达标{incomplete ? ` · ${incomplete} 个未完成` : ""}</p></div></div>
      <p className="evaluation-note">分数是本轮合成场景的检查结果，不代表实盘收益或行业排名。模型评审与被测建议均使用本机 Codex，存在同源偏差。</p>
      <div className="evaluation-summary">
        <RadarChart dimensions={report.dimensions} />
        <dl>{report.dimensions.map(item => <div key={item.id}><dt>{item.label}<small>{item.method} · {item.evaluated}/{item.total} 项</small></dt><dd>{item.score === null ? "未评分" : `${item.score} / 100`}</dd></div>)}</dl>
      </div>
      {report.recommendations.length > 0 && <section className="evaluation-recommendations"><h4>Agent 优化建议</h4><ul>{report.recommendations.map((item, index) => <li key={index}>{item}</li>)}</ul></section>}
      <details className="evaluation-cases"><summary>查看场景、实际输出与评分依据</summary>
        {report.cases.map(item => <details key={item.id} className="evaluation-case"><summary><span><ChevronRight size={14} aria-hidden="true" />{item.title} <small>{item.target}</small></span><strong className={item.status}>{item.status === "passed" ? "通过" : item.status === "failed" ? "未达标" : "未完成"}</strong></summary><p className="evaluation-evidence">{evidenceText(item.evidence)}</p><ul>{item.checks.map((check, index) => <li key={`${check.dimension}-${index}`}><strong>{report.dimensions.find(value => value.id === check.dimension)?.label} · {check.score === null ? "未评分" : `${check.score} 分`}</strong><span>{check.reason}</span>{check.improvement && <span>改进：{check.improvement}</span>}</li>)}</ul></details>)}
      </details>
    </div>}
  </section>;
}
