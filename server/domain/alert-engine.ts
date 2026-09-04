import type { AlertBoundary, AlertState } from './types.js';

export function evaluateAlert(
  price: number,
  lower: number,
  upper: number,
  state: AlertState,
): { event: AlertBoundary | null; state: AlertState } {
  const boundary: AlertBoundary | null = price <= lower ? 'lower' : price >= upper ? 'upper' : null;
  if (!boundary) return { event: null, state: { armed: true, lastBoundary: null } };
  if (!state.armed) return { event: null, state };
  return { event: boundary, state: { armed: false, lastBoundary: boundary } };
}
