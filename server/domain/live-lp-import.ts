import { randomUUID } from 'node:crypto';
import { recommendAlerts } from './smart-alerts.js';
import type { LiveLpPosition, Position } from './types.js';

export function importLivePosition(live: LiveLpPosition): Position {
  const alerts = recommendAlerts(live.rangeLower, live.rangeUpper);
  return {
    id: randomUUID(),
    name: `${live.token0.symbol} / ${live.token1.symbol}`,
    enabled: true,
    source: live.source,
    owner: live.owner,
    token0: live.token0,
    token1: live.token1,
    feeTier: live.feeTier,
    tickSpacing: live.tickSpacing,
    tickLower: live.tickLower,
    tickUpper: live.tickUpper,
    liquidity: live.liquidity,
    rangeLower: live.rangeLower,
    rangeUpper: live.rangeUpper,
    alertLower: alerts.lower,
    alertUpper: alerts.upper,
    currentPrice: live.currentPrice,
    alertState: { armed: true, lastBoundary: null },
    snapshot: live.snapshot,
    history: [live.snapshot],
    feeApr1h: null,
    createdAt: new Date().toISOString(),
  };
}
