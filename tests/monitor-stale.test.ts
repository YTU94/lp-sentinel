import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { LiveLpPosition, Position } from '../server/domain/types.js';
import { refreshPositions } from '../server/monitor.js';
import { JsonStore } from '../server/store.js';

describe('refreshPositions stale guard', () => {
  it('does not append history or change alert state from a stale chain capture', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lp-monitor-stale-'));
    try {
      const store = new JsonStore(join(directory, 'state.json'));
      await store.load();
      const snapshot = { updatedAt: '2026-09-04T09:00:00.000Z', currentPrice: 100, principalValueQuote: 10, feeAmount0: 0, feeAmount1: 0, amount0: 5, amount1: 5, feeValueQuote: 0, totalValueQuote: 10, stale: false };
      const position: Position = {
        id: 'position-1', name: 'AAA / BBB', enabled: true,
        source: { type: 'onchain-v3', sourceId: 'bsc-pancake-v3', chainId: 56, networkName: 'BNB Chain', protocol: 'PancakeSwap V3', tokenId: '42', positionManager: '0x0000000000000000000000000000000000000001', poolAddress: '0x0000000000000000000000000000000000000002', explorerUrl: 'https://example.com' },
        owner: '0x0000000000000000000000000000000000000003',
        token0: { address: '0x0000000000000000000000000000000000000004', symbol: 'AAA', decimals: 18 },
        token1: { address: '0x0000000000000000000000000000000000000005', symbol: 'BBB', decimals: 18 },
        feeTier: 3000, tickSpacing: 60, tickLower: -100, tickUpper: 100, liquidity: '1000', rangeLower: 80, rangeUpper: 120,
        alertLower: 90, alertUpper: 110, currentPrice: 100, alertState: { armed: true, lastBoundary: null }, snapshot, history: [snapshot], feeApr1h: null, createdAt: snapshot.updatedAt,
      };
      await store.update((draft) => { draft.positions = [position]; });
      const staleLive: LiveLpPosition = { ...position, currentTick: 0, currentPrice: 130, snapshot: { ...snapshot, updatedAt: '2026-09-04T09:01:00.000Z', currentPrice: 130, stale: true, error: 'RPC stale' } };
      const state = await refreshPositions(store, async () => staleLive);
      expect(state.positions[0].currentPrice).toBe(130);
      expect(state.positions[0].history).toHaveLength(1);
      expect(state.positions[0].alertState).toEqual({ armed: true, lastBoundary: null });
      expect(state.positions[0].lastError).toBe('RPC stale');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rearms a boundary when delivery fails so the next refresh can retry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lp-monitor-notify-'));
    try {
      const store = new JsonStore(join(directory, 'state.json'));
      await store.load();
      const snapshot = { updatedAt: new Date().toISOString(), currentPrice: 100, principalValueQuote: 10, feeAmount0: 0, feeAmount1: 0, amount0: 5, amount1: 5, feeValueQuote: 0, totalValueQuote: 10, stale: false };
      const position: Position = {
        id: 'position-notify', name: 'AAA / BBB', enabled: true,
        source: { type: 'onchain-v3', sourceId: 'bsc-pancake-v3', chainId: 56, networkName: 'BNB Chain', protocol: 'PancakeSwap V3', tokenId: '42', positionManager: '0x0000000000000000000000000000000000000001', poolAddress: '0x0000000000000000000000000000000000000002', explorerUrl: 'https://example.com' },
        owner: '0x0000000000000000000000000000000000000003',
        token0: { address: '0x0000000000000000000000000000000000000004', symbol: 'AAA', decimals: 18 },
        token1: { address: '0x0000000000000000000000000000000000000005', symbol: 'BBB', decimals: 18 },
        feeTier: 3000, tickSpacing: 60, tickLower: -100, tickUpper: 100, liquidity: '1000', rangeLower: 80, rangeUpper: 120,
        alertLower: 90, alertUpper: 110, currentPrice: 100, alertState: { armed: true, lastBoundary: null }, snapshot, history: [snapshot], feeApr1h: null, createdAt: snapshot.updatedAt,
      };
      await store.update((draft) => { draft.positions = [position]; draft.settings.notificationEnabled = true; });
      const breachedLive: LiveLpPosition = { ...position, currentTick: 0, currentPrice: 115, snapshot: { ...snapshot, currentPrice: 115 } };
      const notifier = vi.fn().mockRejectedValue(new Error('delivery failed'));

      const state = await refreshPositions(store, async () => breachedLive, notifier);

      expect(notifier).toHaveBeenCalledTimes(1);
      expect(state.positions[0].alertState).toEqual({ armed: true, lastBoundary: null });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
