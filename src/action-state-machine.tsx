import { Check, CircleAlert, MousePointerClick, TimerReset } from 'lucide-react';
import type { ActionStatus } from './types';

export function deriveActionStage(input: {
  currentPrice: number | null;
  rangeLower: number;
  rangeUpper: number;
  alertLower: number;
  alertUpper: number;
  alertArmed: boolean;
  coolingDown?: boolean;
  stale?: boolean;
}): ActionStatus {
  if (input.stale) return 'stale';
  if (input.coolingDown) return 'cooldown';
  if (input.currentPrice == null) return 'safe';
  if (input.currentPrice <= input.rangeLower || input.currentPrice >= input.rangeUpper) return 'execute';
  if (!input.alertArmed || input.currentPrice <= input.alertLower || input.currentPrice >= input.alertUpper) return 'warning';
  return 'safe';
}

const steps = [
  { id: 'safe', eyebrow: 'SAFE', title: '持续观察', detail: '价格位于安全航道', icon: Check },
  { id: 'warning', eyebrow: 'WARNING', title: '进入预警', detail: '检查仓位与市场方向', icon: CircleAlert },
  { id: 'execute', eyebrow: 'EXECUTE', title: '选择并确认', detail: '资产操作需钱包确认', icon: MousePointerClick },
  { id: 'cooldown', eyebrow: 'COOLDOWN', title: '防止反复重建', detail: '等待策略冷却结束', icon: TimerReset },
] as const;

export function ActionStateMachine({ active }: { active: ActionStatus }) {
  const activeIndex = steps.findIndex((item) => item.id === active);
  return <><div className="action-flow" aria-label="Action 状态机">
    {steps.map((step, index) => { const Icon = step.icon; return <div className={`action-step ${index === activeIndex ? 'active' : ''} ${index < activeIndex ? 'done' : ''}`} key={step.id}>
      <div className="action-index"><Icon size={16} /></div><div><small>{step.eyebrow}</small><strong>{step.title}</strong><span>{step.detail}</span></div>
    </div>; })}
  </div>{active === 'stale' && <div className="stale-gate"><CircleAlert size={16} /> 链上快照已过期，暂停策略判断</div>}</>;
}
