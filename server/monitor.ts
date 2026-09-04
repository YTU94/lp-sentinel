import { evaluateAlert } from './domain/alert-engine.js';
import { calculateFeeApr1h } from './domain/fee-apr.js';
import type { AlertBoundary, LiveLpPosition, LpSourceId, Position } from './domain/types.js';
import { JsonStore } from './store.js';
import { notifyPosition } from './services/dws-notifier.js';
import { readBySource } from './services/lp-nft-registry.js';

export async function refreshPositions(store: JsonStore, reader: (sourceId: LpSourceId, tokenId: string) => Promise<LiveLpPosition> = readBySource) {
  const events: Array<{ position: Position; boundary: AlertBoundary }> = [];
  const before = store.get();
  const refreshed = await Promise.all(before.positions.map(async (position) => {
    if (!position.enabled) return position;
    try {
      const live = await reader(position.source.sourceId, position.source.tokenId);
      if (live.snapshot.stale) {
        return { ...position, owner: live.owner, liquidity: live.liquidity, currentPrice: live.currentPrice, snapshot: live.snapshot, lastError: live.snapshot.error || '链上快照已过期，已暂停预警判断' };
      }
      const history = [...position.history, live.snapshot].filter((sample) => Date.parse(sample.updatedAt) >= Date.now() - 3_900_000).slice(-100);
      const alert = evaluateAlert(live.currentPrice, position.alertLower, position.alertUpper, position.alertState);
      const next: Position = { ...position, owner: live.owner, liquidity: live.liquidity, currentPrice: live.currentPrice, snapshot: live.snapshot, history, feeApr1h: calculateFeeApr1h(history), alertState: alert.state, lastError: undefined };
      if (alert.event) events.push({ position: next, boundary: alert.event });
      return next;
    } catch {
      return { ...position, lastError: '链上刷新失败，保留最后一次已知快照', snapshot: position.snapshot ? { ...position.snapshot, stale: true, error: '链上刷新失败' } : null };
    }
  }));
  await store.update((draft) => { draft.positions = refreshed; });
  await Promise.allSettled(events.map((event) => notifyPosition(event.position, event.boundary, store.get().settings)));
  return store.get();
}

export interface MonitorController {
  refreshNow: () => Promise<ReturnType<JsonStore['get']>>;
  reschedule: () => void;
  stop: () => void;
}

export function startMonitor(store: JsonStore, refresher: (target: JsonStore) => Promise<ReturnType<JsonStore['get']>> = refreshPositions): MonitorController {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let inFlight: Promise<ReturnType<JsonStore['get']>> | null = null;
  const schedule = () => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void refreshNow().catch(() => schedule()); }, Math.max(5_000, store.get().settings.pollIntervalMs));
    timer.unref?.();
  };
  const run = () => {
    if (!inFlight) inFlight = refresher(store).finally(() => { inFlight = null; });
    return inFlight;
  };
  const refreshNow = async () => {
    if (timer) clearTimeout(timer);
    const state = await run();
    schedule();
    return state;
  };
  const reschedule = () => schedule();
  const stop = () => { stopped = true; if (timer) clearTimeout(timer); };
  void refreshNow().catch(() => schedule());
  return { refreshNow, reschedule, stop };
}
