import { Activity, Clock3, Play, ShieldCheck } from "lucide-react";
import type { Position } from "./types";

export type ActionStage = "safe" | "warning" | "execute" | "cooldown";

export function deriveActionStage(position: Position): ActionStage {
  const price = position.currentPrice;
  if (price === undefined) return "safe";
  if (price <= position.lowerPrice || price >= position.upperPrice || position.simulation?.status === "below" || position.simulation?.status === "above") {
    return "execute";
  }
  if (price <= position.alertLower || price >= position.alertUpper || !position.alertState.armed) return "warning";
  return "safe";
}

const stages = [
  {
    id: "safe",
    label: "SAFE",
    title: "持续观察",
    description: "价格位于预警线之间，保持当前 LP。",
    icon: ShieldCheck,
  },
  {
    id: "warning",
    label: "WARNING",
    title: "进入预警",
    description: "触及智能预警线，加速采样，暂不移除。",
    icon: Activity,
  },
  {
    id: "execute",
    label: "EXECUTE",
    title: "选择并确认",
    description: "比较持有、双币移除或 Zap 后重建，确认净收益后执行。",
    icon: Play,
  },
  {
    id: "cooldown",
    label: "COOLDOWN",
    title: "防止反复重建",
    description: "建议冷却 2–4 小时，紧急风险除外。",
    icon: Clock3,
  },
] as const;

const stageSummary: Record<ActionStage, string> = {
  safe: "价格仍在安全航道，当前动作是保持仓位。",
  warning: "价格已进入预警带，系统开始准备报价与候选方案。",
  execute: "价格已越过 LP 边界，比较动作后等待钱包确认。",
  cooldown: "刚完成一次调整，暂时抑制重复重建。",
};

export function ActionStateMachine({ position }: { position: Position }) {
  const currentStage = deriveActionStage(position);

  return <section className="action-machine" aria-labelledby={`action-machine-${position.id}`}>
    <div className="action-machine-heading">
      <div>
        <h2 id={`action-machine-${position.id}`}>智能预警 Action</h2>
        <p>{stageSummary[currentStage]}</p>
      </div>
      <span className={`action-current action-current-${currentStage}`}>当前阶段 · {stages.find((stage) => stage.id === currentStage)?.label}</span>
    </div>
    <ol className="action-flow" aria-label="智能预警 Action 状态流程">
      {stages.map((stage, index) => {
        const Icon = stage.icon;
        const active = stage.id === currentStage;
        return <li
          className={`action-stage action-stage-${stage.id}${active ? " active" : ""}`}
          data-stage={stage.id}
          aria-current={active ? "step" : undefined}
          key={stage.id}
        >
          <div className="action-stage-top"><span>{index + 1}</span><Icon size={18} aria-hidden="true" /></div>
          <strong>{stage.label}</strong>
          <b>{stage.title}</b>
          <p>{stage.description}</p>
          <small>{active ? "当前阶段" : index < stages.findIndex((item) => item.id === currentStage) ? "已通过" : "后续阶段"}</small>
        </li>;
      })}
    </ol>
    <div className="action-machine-note"><ShieldCheck size={15} aria-hidden="true" />策略预览，不会自动发起交易；真实资产操作仍需钱包确认。</div>
  </section>;
}
