import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../server/index.js';
import { JsonStore } from '../server/store.js';
import type { LiveLpPosition } from '../server/domain/types.js';

let directory: string;
let store: JsonStore;

const live = (sourceId: 'robinhood-uniswap-v3' | 'bsc-pancake-v3'): LiveLpPosition => ({
  source: { type: 'onchain-v3', sourceId, chainId: sourceId.startsWith('bsc') ? 56 : 4663, networkName: 'Testnet', protocol: 'V3', tokenId: '42', positionManager: '0x0000000000000000000000000000000000000001', poolAddress: '0x0000000000000000000000000000000000000002', explorerUrl: 'https://example.com' },
  owner: '0x0000000000000000000000000000000000000003',
  token0: { address: '0x0000000000000000000000000000000000000004', symbol: 'AAA', decimals: 18 },
  token1: { address: '0x0000000000000000000000000000000000000005', symbol: 'BBB', decimals: 18 },
  feeTier: 3000, tickSpacing: 60, tickLower: -100, tickUpper: 100, currentTick: 0, liquidity: '1000', rangeLower: 0.99, rangeUpper: 1.01, currentPrice: 1,
  snapshot: { updatedAt: new Date().toISOString(), currentPrice: 1, principalValueQuote: 10, feeAmount0: 0, feeAmount1: 0, amount0: 5, amount1: 5, feeValueQuote: 0, totalValueQuote: 10, stale: false },
});

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'lp-sentinel-'));
  store = new JsonStore(join(directory, 'state.json'));
  await store.load();
});

afterEach(async () => rm(directory, { recursive: true, force: true }));

describe('LP Sentinel API', () => {
  it('rejects invalid NFT IDs before probing sources', async () => {
    const lookup = vi.fn();
    const app = createApp({ store, lookup });
    await request(app).get('/api/lp-nft/not-a-number').expect(400);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('keeps all cross-chain matches', async () => {
    const app = createApp({ store, lookup: vi.fn().mockResolvedValue({ matches: [live('robinhood-uniswap-v3'), live('bsc-pancake-v3')], probes: [] }) });
    const response = await request(app).get('/api/lp-nft/42').expect(200);
    expect(response.body.matches).toHaveLength(2);
  });

  it('requires an explicit source when importing', async () => {
    const app = createApp({ store, lookup: vi.fn().mockResolvedValue({ matches: [], probes: [] }) });
    await request(app).post('/api/positions/from-lp-nft').send({ tokenId: '42' }).expect(400);
  });

  it('reschedules monitoring after polling settings change', async () => {
    const onSettingsChanged = vi.fn();
    const app = createApp({ store, onSettingsChanged });
    const response = await request(app).patch('/api/settings').send({ pollIntervalMs: 8_000 }).expect(200);
    expect(response.body.pollIntervalMs).toBe(8_000);
    expect(onSettingsChanged).toHaveBeenCalledTimes(1);
  });

  it('reports Vercel runtime limits without exposing local state capabilities', async () => {
    const app = createApp({
      store,
      runtime: { mode: 'vercel', persistent: false, backgroundMonitoring: false, notifications: false, positionStorage: 'indexeddb' },
    });
    const response = await request(app).get('/api/state').expect(200);
    expect(response.body.runtime).toEqual({
      mode: 'vercel',
      persistent: false,
      backgroundMonitoring: false,
      notifications: false,
      positionStorage: 'indexeddb',
    });
  });

  it('keeps every notification channel disabled on Vercel', async () => {
    const app = createApp({
      store,
      runtime: { mode: 'vercel', persistent: false, backgroundMonitoring: false, notifications: false, positionStorage: 'indexeddb' },
    });
    const response = await request(app).patch('/api/settings').send({
      notificationEnabled: true,
      dingEnabled: true,
      dingCallEnabled: true,
      dingRobotCode: 'must-not-be-stored',
    }).expect(200);
    expect(response.body).toMatchObject({
      notificationEnabled: false,
      dingEnabled: false,
      dingCallEnabled: false,
      dingRobotCode: '',
    });
  });

  it('hydrates runtime positions from IndexedDB base records', async () => {
    const readPosition = vi.fn().mockResolvedValue(live('bsc-pancake-v3'));
    const app = createApp({ store, readPosition });
    const response = await request(app).put('/api/positions/sync').send({
      positions: [{
        id: 'local-position',
        sourceId: 'bsc-pancake-v3',
        tokenId: '42',
        enabled: false,
        alertLower: 0.995,
        alertUpper: 1.005,
        alertState: { armed: false, lastBoundary: 'upper' },
        createdAt: '2026-09-04T00:00:00.000Z',
      }],
    }).expect(200);

    expect(readPosition).toHaveBeenCalledWith('bsc-pancake-v3', '42');
    expect(response.body.positions[0]).toMatchObject({
      id: 'local-position',
      enabled: false,
      alertLower: 0.995,
      alertUpper: 1.005,
      alertState: { armed: false, lastBoundary: 'upper' },
    });
  });
});
