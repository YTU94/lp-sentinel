import { describe, expect, it } from 'vitest';
import { priceFreshness } from '../src/price-freshness.js';

describe('priceFreshness', () => {
  const now = Date.parse('2026-09-04T09:00:00Z');

  it('distinguishes live, delayed and stale snapshots', () => {
    expect(priceFreshness({ updatedAt: new Date(now - 30_000).toISOString(), blockLag: 2, stale: false }, now).status).toBe('live');
    expect(priceFreshness({ updatedAt: new Date(now - 180_000).toISOString(), blockLag: 2, stale: false }, now).status).toBe('delayed');
    expect(priceFreshness({ updatedAt: new Date(now - 601_000).toISOString(), blockLag: 2, stale: false }, now).status).toBe('stale');
  });

  it('never calls an errored or lagging capture live', () => {
    expect(priceFreshness({ updatedAt: new Date(now).toISOString(), blockLag: 50, stale: false }, now).status).toBe('delayed');
    expect(priceFreshness({ updatedAt: new Date(now).toISOString(), blockLag: 0, stale: true, error: 'rpc' }, now).status).toBe('stale');
  });

  it('uses block time instead of a fixed block count on fast chains', () => {
    expect(priceFreshness({
      updatedAt: new Date(now - 1_000).toISOString(),
      observedAt: new Date(now - 1_000).toISOString(),
      blockTimestamp: new Date(now - 4_000).toISOString(),
      blockLag: 14,
      stale: false,
    }, now).status).toBe('live');
  });
});
