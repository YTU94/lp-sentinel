import { useEffect, useId, useState } from "react";
import type { LpRangeActivity, RangeActivityDay, RangeActivityState } from "../shared/range-activity";
import type { PortfolioPosition } from "../shared/portfolio";
import { api } from "./api";
import "./range-activity.css";

const labels: Record<RangeActivityState, string> = {
  "in-range": "区间内", "out-of-range": "区间外", unknown: "历史缺口", inactive: "未持仓", future: "未到时间",
};
const hours = (seconds: number) => `${(seconds / 3600).toFixed(1)} 小时`;
const percent = (day: RangeActivityDay) => day.inRangePercent === null ? "—" : `${day.inRangePercent.toFixed(1)}%`;
const apr = (day: RangeActivityDay) => day.income && Number.isFinite(day.income.annualizedPercent) ? `≈${day.income.annualizedPercent.toFixed(2)}%` : "—";
const usd = (value: number) => value.toLocaleString("zh-CN", { style: "currency", currency: "USD", maximumSignificantDigits: 6 });

export function RangeActivity({ address, position }: { address: string; position: PortfolioPosition }) {
  const [data, setData] = useState<LpRangeActivity>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [selectedDate, setSelectedDate] = useState("");
  const patternId = `range-gap-${useId().replace(/:/g, "")}`;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void api.rangeActivity(address, position.sourceId, position.key, controller.signal, attempt > 0).then(result => {
      if (controller.signal.aborted) return;
      if (result.version !== 1 || result.positionKey !== position.key || !Array.isArray(result.days) || !result.days.length || !Number.isFinite(Date.parse(result.expiresAt)) || !Number.isFinite(Date.parse(result.fetchedAt))) throw new Error("历史响应未通过校验，请重试");
      setData(result);
      setSelectedDate(current => result.days.some(day => day.date === current) ? current : result.days.filter(day => day.inRangePercent !== null).at(-1)?.date ?? result.days.at(-1)!.date);
    }).catch(cause => {
      if (!controller.signal.aborted) {
        const message = cause instanceof Error ? cause.message : "有效区间历史暂不可用";
        setError(message);
        if (message.includes("重新查询地址")) setData(undefined);
      }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [address, position.sourceId, position.key, attempt]);

  useEffect(() => {
    if (!data) return;
    const delay = Math.max(1000, Math.min(300_000, Date.parse(data.expiresAt) - Date.now()));
    const timer = window.setTimeout(() => setAttempt(value => value + 1), delay);
    return () => window.clearTimeout(timer);
  }, [data]);

  const selected = data?.days.find(day => day.date === selectedDate);
  const visibleDays = data ? showAll ? data.days : data.days.slice(-7) : [];

  return <section className="range-activity" aria-label="每日有效区间时间" aria-busy={loading}>
    <header className="range-activity-heading"><h3>每日有效区间</h3><span>{loading && data ? "更新中 · 北京时间" : data?.method === "snapshot-and-events" ? "快照 + 事件 · 北京时间" : "采样估算 · 北京时间"}</span></header>
    {loading && !data && <p className="range-activity-message" role="status">正在读取 Revert 历史并校准缺口，首次回放可能需要约一分钟…</p>}
    {error && <div className="range-activity-error"><p role="alert">{error}</p>{!error.includes("重新查询地址") && <button type="button" onClick={() => setAttempt(value => value + 1)}>重新读取历史</button>}</div>}
    {!error && data && <>
      <div className="range-activity-axis" aria-hidden="true"><span>日期</span><div>{[0, 6, 12, 18, 24].map(hour => <span key={hour}>{hour}</span>)}</div><span>有效占比</span><span>当日 APR</span></div>
      <div className="range-activity-days" role="group" aria-label="选择日期查看有效时长">
        {visibleDays.map(day => <button type="button" className={`range-activity-row${day.date === selectedDate ? " selected" : ""}`} key={day.date} aria-pressed={day.date === selectedDate} aria-label={`${day.date}，有效占比${day.inRangePercent === null ? "等待历史" : `${percent(day)}，估算`}，区间内${hours(day.seconds["in-range"])}，历史缺口${hours(day.seconds.unknown)}，当日年化 APR ${day.income ? apr(day) : "数据不足"}`} onClick={() => setSelectedDate(day.date)}>
          <span className="range-activity-date">{day.date.slice(5).replace("-", "/")}</span>
          <svg className="range-activity-timeline" viewBox="0 0 240 18" preserveAspectRatio="none" aria-hidden="true">
            <defs><pattern id={`${patternId}-${day.date}`} width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="5" className="range-activity-gap-ground" /><path d="M-1 1L1 -1M0 5L5 0M4 6L6 4" className="range-activity-gap-stroke" /></pattern></defs>
            {day.segments.map(segment => <rect key={segment.fromSecond} x={segment.fromSecond / 360} y="0" width={(segment.toSecond - segment.fromSecond) / 360} height="18" className={`range-activity-${segment.state}`} fill={segment.state === "unknown" ? `url(#${patternId}-${day.date})` : undefined} />)}
            {Array.from({ length: 23 }, (_, index) => <line key={index} x1={(index + 1) * 10} x2={(index + 1) * 10} y1="0" y2="18" className="range-activity-hour-line" />)}
          </svg>
          <span className="range-activity-percent">{percent(day)}</span>
          <span className="range-activity-apr" title={day.income ? `手续费 ${usd(day.income.feesUsd)} + 奖励 ${usd(day.income.rewardsUsd)}，平均本金 ${usd(day.income.averagePrincipalUsd)}，收益采样 ${hours(day.income.sampledSeconds)}` : "收益历史不足，暂无法计算"}>{apr(day)}</span>
        </button>)}
      </div>
      {data.days.length > 7 && <button className="range-activity-expand" type="button" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? "收起为最近 7 天" : `展开全部 ${data.days.length} 天`}</button>}
      <div className="range-activity-legend" aria-label="时间图图例">{Object.entries(labels).map(([state, label]) => <span key={state}><i className={`range-activity-key ${state}`} aria-hidden="true" />{label}</span>)}</div>
      {selected && <div className="range-activity-detail" aria-live="polite">
        <p><strong>{selected.date}</strong><span>{selected.seconds.future > 0 ? "当天进行中" : "完整自然日"}</span></p>
        <p>有效 {hours(selected.seconds["in-range"])} / 24 小时 <strong>{percent(selected)}</strong></p>
        <p>区间外 {hours(selected.seconds["out-of-range"])} · 缺口 {hours(selected.seconds.unknown)}</p>
        {(selected.seconds.inactive > 0 || selected.seconds.future > 0) && <p>未持仓 {hours(selected.seconds.inactive)} · 未到时间 {hours(selected.seconds.future)}</p>}
        {selected.coveragePercent !== undefined && <p>历史覆盖 {selected.coveragePercent.toFixed(1)}% · 事件校准 {hours(selected.eventSeconds ?? 0)}</p>}
        <p><span>当日年化 APR · 估算</span><strong>{apr(selected)}</strong></p>
        {selected.income ? <>
          <p><span>手续费 {usd(selected.income.feesUsd)}</span><span>奖励 {usd(selected.income.rewardsUsd)}</span></p>
          <p><span>平均本金 {usd(selected.income.averagePrincipalUsd)}</span><span>收益采样 {hours(selected.income.sampledSeconds)}</span></p>
        </> : <p>收益历史不足，暂无法计算。</p>}
      </div>}
      <p className="range-activity-note">Revert 快照间隔超过 {data.maxGapSeconds / 3600} 小时记为缺口，再用池价与 NFT 流动性事件回放校准。每日占比为有效时长 ÷ 24 小时，采样时段保留估算误差。</p>
      <p className="range-activity-note">当日 APR = 当日采样手续费与奖励 ÷ 时间加权平均本金 × 365。收益按北京时间分日，不含币价涨跌；跨日快照按时长分摊。当天未结束或收益历史有缺口时，仅计已采样收益，不外推全天；有效采样不足 1 分钟或数据缺失时显示“—”。</p>
      <p className="range-activity-source">Revert · {data.sampleCount} 条观测 · 读取于 {new Date(data.fetchedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</p>
      {data.replay?.throughAt && <p className="range-activity-source">链上回放 {data.replay.eventCount.toLocaleString()} 个状态点 · 截至 {new Date(data.replay.throughAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</p>}
      {data.warnings.map(warning => <p className="portfolio-warning" key={warning}>{warning}</p>)}
      {data.replay?.status !== "complete" && data.days.some(day => day.seconds.unknown >= 60) && <button className="range-activity-expand" type="button" disabled={loading} onClick={() => setAttempt(value => value + 1)}>{loading ? "正在校准缺口…" : "重新补齐缺口"}</button>}
    </>}
  </section>;
}
