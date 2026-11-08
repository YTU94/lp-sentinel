import type { LpRangeActivity, RangeActivityDay, RangeActivityState } from "../../shared/range-activity.js";

const DAY = 86_400;
const OFFSET = 8 * 3_600;
const MAX_GAP = 3 * 3_600;

export interface DailyIncomeSample {
  at: string;
  principalUsd?: number;
  fees0?: number;
  fees1?: number;
  price0Usd?: number;
  price1Usd?: number;
  rewards?: Record<string, { amount?: number; priceUsd?: number }>;
}

export function addDailyIncomeApr(activity: LpRangeActivity, samples: DailyIncomeSample[]): LpRangeActivity {
  const asOf = Date.parse(activity.fetchedAt) / 1000;
  const ordered = [...new Map(samples.map(sample => [Date.parse(sample.at) / 1000, sample])).entries()]
    .filter(([time]) => Number.isFinite(time) && time <= asOf).sort((a, b) => a[0] - b[0]);
  const days = activity.days.map(day => {
    const start = Date.parse(`${day.date}T00:00:00+08:00`) / 1000;
    let feesUsd = 0, rewardsUsd = 0, principalTime = 0, sampledSeconds = 0;
    for (let index = 1; index < ordered.length; index++) {
      const [previousTime, previous] = ordered[index - 1], [currentTime, current] = ordered[index];
      const interval = currentTime - previousTime;
      const from = Math.max(start, previousTime), to = Math.min(start + DAY, currentTime);
      if (to <= from || interval <= 0 || interval > MAX_GAP || !previous.rewards || !current.rewards) continue;
      if ([previous.principalUsd, current.principalUsd, previous.fees0, previous.fees1, current.fees0, current.fees1, current.price0Usd, current.price1Usd]
        .some(value => value === undefined || !Number.isFinite(value) || value < 0)) continue;
      const growth0 = current.fees0! - previous.fees0!, growth1 = current.fees1! - previous.fees1!;
      if (growth0 < 0 || growth1 < 0 || growth0 > 0 && current.price0Usd === 0 || growth1 > 0 && current.price1Usd === 0) continue;
      const intervalFees = growth0 * current.price0Usd! + growth1 * current.price1Usd!;
      let intervalRewards = 0, valid = true;
      for (const token of new Set([...Object.keys(previous.rewards), ...Object.keys(current.rewards)])) {
        const before = previous.rewards[token], after = current.rewards[token];
        const oldAmount = before ? before.amount : 0, newAmount = after ? after.amount : 0;
        if (oldAmount === undefined || newAmount === undefined || !Number.isFinite(oldAmount) || !Number.isFinite(newAmount) || oldAmount < 0 || newAmount < oldAmount) { valid = false; break; }
        const growth = newAmount - oldAmount;
        if (growth > 0) {
          if (after?.priceUsd === undefined || !Number.isFinite(after.priceUsd) || after.priceUsd <= 0) { valid = false; break; }
          intervalRewards += growth * after.priceUsd;
        }
      }
      if (!valid || !Number.isFinite(intervalFees) || !Number.isFinite(intervalRewards)) continue;
      const duration = to - from;
      const capitalChange = current.principalUsd! - previous.principalUsd!;
      const average = previous.principalUsd! + capitalChange * ((from + to) / 2 - previousTime) / interval;
      if (!Number.isFinite(average) || average <= 0) continue;
      // shortcut: Split snapshot income uniformly across midnight; use event-level earnings if exact daily attribution is needed.
      feesUsd += intervalFees * duration / interval;
      rewardsUsd += intervalRewards * duration / interval;
      principalTime += average * duration;
      sampledSeconds += duration;
    }
    const averagePrincipalUsd = principalTime / sampledSeconds;
    const annualizedPercent = (feesUsd + rewardsUsd) / averagePrincipalUsd * 365 * 100;
    const income = sampledSeconds >= 60 && Number.isFinite(annualizedPercent) && Number.isFinite(averagePrincipalUsd) && averagePrincipalUsd > 0
      ? { annualizedPercent, feesUsd, rewardsUsd, averagePrincipalUsd, sampledSeconds } : undefined;
    return { ...day, income };
  });
  return { ...activity, days };
}

function summarizeDay(date: string, segments: RangeActivityDay["segments"]): RangeActivityDay {
  const seconds: RangeActivityDay["seconds"] = { "in-range": 0, "out-of-range": 0, unknown: 0, inactive: 0, future: 0 };
  let eventSeconds = 0;
  for (const segment of segments) {
    const duration = segment.toSecond - segment.fromSecond;
    seconds[segment.state] += duration;
    if (segment.basis === "events") eventSeconds += duration;
  }
  const hasEstimate = seconds["in-range"] + seconds["out-of-range"] > 0 || seconds.unknown === 0 && seconds.future === 0;
  const elapsed = DAY - seconds.future;
  return {
    date, seconds, segments, eventSeconds,
    coveragePercent: elapsed > 0 ? (elapsed - seconds.unknown) / elapsed * 100 : 0,
    inRangePercent: hasEstimate ? seconds["in-range"] / DAY * 100 : null,
  };
}

export function applyRangeActivityReplay(activity: LpRangeActivity, recovered: { from: number; to: number; state: "in-range" | "out-of-range" | "inactive" }[]): LpRangeActivity {
  const days = activity.days.map(day => {
    const start = Date.parse(`${day.date}T00:00:00+08:00`) / 1000;
    const segments: RangeActivityDay["segments"] = [];
    for (const segment of day.segments) {
      if (segment.state !== "unknown") { segments.push(segment); continue; }
      let cursor = segment.fromSecond;
      for (const span of recovered) {
        const from = Math.max(cursor, span.from - start);
        const to = Math.min(segment.toSecond, span.to - start);
        if (to <= from) continue;
        if (from > cursor) segments.push({ fromSecond: cursor, toSecond: from, state: "unknown" });
        segments.push({ fromSecond: from, toSecond: to, state: span.state, basis: "events" });
        cursor = to;
      }
      if (cursor < segment.toSecond) segments.push({ fromSecond: cursor, toSecond: segment.toSecond, state: "unknown" });
    }
    return summarizeDay(day.date, segments);
  });
  const filled = days.some(day => (day.eventSeconds ?? 0) > 0);
  return { ...activity, days, source: filled ? "revert+onchain" : "revert", method: filled ? "snapshot-and-events" : "snapshot-step" };
}

export function calculateRangeActivity(input: {
  positionKey: string;
  snapshots: { at: string; inRange: boolean; active?: boolean }[];
  createdAt?: string;
  asOf: string;
  downsampled: boolean;
}): LpRangeActivity {
  const now = Math.floor(Date.parse(input.asOf) / 1000);
  if (!Number.isFinite(now) || now < 30 * DAY) throw new Error("有效区间统计时间无效");
  const today = Math.floor((now + OFFSET) / DAY) * DAY - OFFSET;
  const windowStart = today - 29 * DAY;
  const created = input.createdAt ? Math.floor(Date.parse(input.createdAt) / 1000) : NaN;
  const createdAt = Number.isFinite(created) && created > 0 && created <= now ? created : undefined;
  const firstDay = createdAt === undefined ? windowStart : Math.max(windowStart, Math.floor((createdAt + OFFSET) / DAY) * DAY - OFFSET);
  const points = new Map<number, RangeActivityState>();
  for (const snapshot of input.snapshots) {
    const time = Math.floor(Date.parse(snapshot.at) / 1000);
    if (!Number.isFinite(time) || time > now || time < firstDay - MAX_GAP || createdAt !== undefined && time < createdAt) continue;
    const state: RangeActivityState = snapshot.active === undefined ? "unknown" : !snapshot.active ? "inactive" : snapshot.inRange ? "in-range" : "out-of-range";
    points.set(time, points.has(time) && points.get(time) !== state ? "unknown" : state);
  }
  const ordered = [...points].sort((a, b) => a[0] - b[0]);
  const spans: { from: number; to: number; state: RangeActivityState }[] = [];
  function append(from: number, to: number, state: RangeActivityState) {
    if (to <= from) return;
    const previous = spans.at(-1);
    if (previous?.state === state && previous.to === from) previous.to = to;
    else spans.push({ from, to, state });
  }
  let cursor = firstDay;
  if (createdAt !== undefined && createdAt > cursor) {
    append(cursor, createdAt, "inactive");
    cursor = createdAt;
  }
  for (let index = 0; index + 1 < ordered.length && cursor < now; index++) {
    const [time, state] = ordered[index];
    const next = ordered[index + 1][0];
    if (next <= cursor) continue;
    const from = Math.max(cursor, time);
    const to = Math.min(next, now);
    append(cursor, from, "unknown");
    append(from, to, next - time <= MAX_GAP ? state : "unknown");
    cursor = to;
  }
  append(cursor, now, "unknown");
  append(now, today + DAY, "future");

  const days: RangeActivityDay[] = [];
  for (let start = firstDay; start <= today; start += DAY) {
    const segments: RangeActivityDay["segments"] = [];
    for (const span of spans) {
      const from = Math.max(start, span.from);
      const to = Math.min(start + DAY, span.to);
      if (to <= from) continue;
      segments.push({ fromSecond: from - start, toSecond: to - start, state: span.state });
    }
    days.push(summarizeDay(new Date((start + OFFSET) * 1000).toISOString().slice(0, 10), segments));
  }
  const warnings: string[] = [];
  if (createdAt === undefined) warnings.push("建仓时间未取得，首条可用观测之前显示为历史缺口。");
  if (input.downsampled) warnings.push("数据源历史已抽样，图中时段按返回的采样间隔估算。");
  return {
    version: 1, positionKey: input.positionKey, source: "revert", timezone: "Asia/Shanghai", method: "snapshot-step",
    maxGapSeconds: MAX_GAP, fetchedAt: new Date(now * 1000).toISOString(),
    expiresAt: new Date(Math.min(now + 300, today + DAY) * 1000).toISOString(),
    createdAt: createdAt === undefined ? undefined : new Date(createdAt * 1000).toISOString(),
    sampleCount: ordered.length, downsampled: input.downsampled, days, warnings,
  };
}
