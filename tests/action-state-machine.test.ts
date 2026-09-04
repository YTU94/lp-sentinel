import { describe, expect, it } from 'vitest';
import { deriveActionStage } from '../src/action-state-machine.js';

describe('deriveActionStage', () => {
  it('distinguishes safe, warning and out-of-range execution', () => {
    const base = { rangeLower: 80, rangeUpper: 120, alertLower: 90, alertUpper: 110, alertArmed: true };
    expect(deriveActionStage({ ...base, currentPrice: null })).toBe('safe');
    expect(deriveActionStage({ ...base, currentPrice: 100 })).toBe('safe');
    expect(deriveActionStage({ ...base, currentPrice: 89 })).toBe('warning');
    expect(deriveActionStage({ ...base, currentPrice: 79 })).toBe('execute');
    expect(deriveActionStage({ ...base, currentPrice: 100, stale: true })).toBe('stale');
  });
});
