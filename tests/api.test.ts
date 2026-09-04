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

  it('reports that Vercel cannot inherit the local DWS login', async () => {
    const app = createApp({
      store,
      runtime: { mode: 'vercel', persistent: false, backgroundMonitoring: false, notifications: false, notificationProvider: 'none', positionStorage: 'indexeddb' },
    });
    const response = await request(app).get('/api/state').expect(200);
    expect(response.body.runtime).toEqual({
      mode: 'vercel',
      persistent: false,
      backgroundMonitoring: false,
      notifications: false,
      notificationProvider: 'none',
      positionStorage: 'indexeddb',
    });
  });

  it('locks notification settings when the runtime has no DWS CLI', async () => {
    const app = createApp({
      store,
      runtime: { mode: 'vercel', persistent: false, backgroundMonitoring: false, notifications: false, notificationProvider: 'none', positionStorage: 'indexeddb' },
    });
    const response = await request(app).patch('/api/settings').send({
      notificationEnabled: true,
      dingEnabled: true,
      dingCallEnabled: true,
    }).expect(200);
    expect(response.body).toMatchObject({
      notificationEnabled: false,
      dingEnabled: false,
      dingCallEnabled: false,
    });
    expect(response.body).not.toHaveProperty('dingRobotCode');
  });

  it('refreshes local DWS auth status without returning credentials', async () => {
    const getAuthStatus = vi.fn().mockResolvedValue({ authenticated: true, user: 'Alice', checkedAt: '2026-09-04T00:00:00.000Z' });
    const app = createApp({ store, getAuthStatus });
    const response = await request(app).get('/api/notifications/auth').expect(200);
    expect(response.body).toEqual({ authenticated: true, user: 'Alice', checkedAt: '2026-09-04T00:00:00.000Z' });
    expect(store.get().notification).toEqual(response.body);
  });

  it('sends a local DWS test notification after checking auth', async () => {
    const getAuthStatus = vi.fn().mockResolvedValue({ authenticated: true, user: 'Alice', checkedAt: '2026-09-04T00:00:00.000Z' });
    const testNotification = vi.fn().mockResolvedValue(undefined);
    const app = createApp({ store, getAuthStatus, testNotification });
    await request(app).post('/api/notifications/test').expect(200, { sent: true });
    expect(testNotification).toHaveBeenCalledTimes(1);
  });

  it('does not send a test notification when DWS is not authenticated', async () => {
    const getAuthStatus = vi.fn().mockResolvedValue({ authenticated: false, checkedAt: '2026-09-04T00:00:00.000Z', error: 'DWS 未登录' });
    const testNotification = vi.fn();
    const app = createApp({ store, getAuthStatus, testNotification });
    await request(app).post('/api/notifications/test').expect(409, { error: 'DWS 未登录' });
    expect(testNotification).not.toHaveBeenCalled();
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

  it('hydrates and refreshes Vercel positions atomically from the request payload', async () => {
    const readPosition = vi.fn().mockResolvedValue(live('bsc-pancake-v3'));
    const refresh = vi.fn(async () => store.get());
    const app = createApp({
      store,
      readPosition,
      refresh,
      runtime: { mode: 'vercel', persistent: false, backgroundMonitoring: false, notifications: false, notificationProvider: 'none', positionStorage: 'indexeddb' },
    });
    const response = await request(app).post('/api/refresh').send({
      positions: [{
        id: 'browser-position',
        sourceId: 'bsc-pancake-v3',
        tokenId: '42',
        enabled: true,
        alertLower: 0.995,
        alertUpper: 1.005,
        alertState: { armed: true, lastBoundary: null },
        createdAt: '2026-09-04T00:00:00.000Z',
      }],
    }).expect(200);

    expect(readPosition).toHaveBeenCalledWith('bsc-pancake-v3', '42');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(response.body.positions[0].id).toBe('browser-position');
  });

  it('allows Vercel refresh without a notification bearer token when DWS is unavailable', async () => {
    const refresh = vi.fn(async () => store.get());
    const app = createApp({
      store,
      refresh,
      runtime: { mode: 'vercel', persistent: false, backgroundMonitoring: false, notifications: false, notificationProvider: 'none', positionStorage: 'indexeddb' },
    });

    await request(app).post('/api/refresh').send({ positions: [] }).expect(200);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not expose the DWS notification test endpoint on Vercel', async () => {
    const testNotification = vi.fn().mockResolvedValue(undefined);
    const app = createApp({
      store,
      testNotification,
      runtime: { mode: 'vercel', persistent: false, backgroundMonitoring: false, notifications: false, notificationProvider: 'none', positionStorage: 'indexeddb' },
    });

    await request(app).post('/api/notifications/test').expect(503);
    expect(testNotification).not.toHaveBeenCalled();
  });
});
