import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { IndexedDbPositionStore, toStoredPosition } from '../src/indexeddb-position-store';
import type { Position } from '../src/types';

const databaseName = 'lp-sentinel-position-store-test';
const position = {
  id: 'position-1',
  name: 'AAA / BBB',
  enabled: true,
  source: { sourceId: 'bsc-pancake-v3', tokenId: '42' },
  alertLower: 90,
  alertUpper: 110,
  alertState: { armed: false, lastBoundary: 'upper' },
  createdAt: '2026-09-04T00:00:00.000Z',
  snapshot: { currentPrice: 101 },
  history: [{ currentPrice: 100 }],
} as Position;

afterEach(() => new Promise<void>((resolve, reject) => {
  const request = indexedDB.deleteDatabase(databaseName);
  request.onsuccess = () => resolve();
  request.onerror = () => reject(request.error);
}));

describe('IndexedDB LP position store', () => {
  it('persists only the user-owned base position fields', async () => {
    const store = new IndexedDbPositionStore(databaseName);
    await store.put(toStoredPosition(position));
    const stored = await store.getAll();
    store.close();

    expect(stored).toEqual([{
      key: 'bsc-pancake-v3:42',
      id: 'position-1',
      sourceId: 'bsc-pancake-v3',
      tokenId: '42',
      enabled: true,
      alertLower: 90,
      alertUpper: 110,
      alertState: { armed: false, lastBoundary: 'upper' },
      createdAt: '2026-09-04T00:00:00.000Z',
    }]);
    expect(stored[0]).not.toHaveProperty('snapshot');
    expect(stored[0]).not.toHaveProperty('history');
  });

  it('upserts by source and NFT ID and supports local deletion', async () => {
    const store = new IndexedDbPositionStore(databaseName);
    const base = toStoredPosition(position);
    await store.put(base);
    await store.put({ ...base, enabled: false });
    expect(await store.getAll()).toHaveLength(1);
    expect((await store.getAll())[0].enabled).toBe(false);
    await store.remove(base.key);
    expect(await store.getAll()).toEqual([]);
    store.close();
  });
});
