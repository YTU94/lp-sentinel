import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultState, JsonStore } from '../server/store.js';

describe('JsonStore realtime polling migration', () => {
  it('migrates the legacy five-minute default to five seconds once', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lp-store-migration-'));
    const file = join(directory, 'state.json');
    try {
      await writeFile(file, JSON.stringify({
        positions: [],
        settings: { pollIntervalMs: 300_000, notificationEnabled: true, dingEnabled: false, dingCallEnabled: false, dingRobotCode: '' },
        notification: { authenticated: false },
        updatedAt: '2026-09-04T09:00:00.000Z',
      }));
      const store = new JsonStore(file);
      const state = await store.load();
      expect(state.settings.pollIntervalMs).toBe(5_000);
      expect((state as { schemaVersion?: number }).schemaVersion).toBe(2);
      expect(JSON.parse(await readFile(file, 'utf8')).schemaVersion).toBe(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps legacy positions until IndexedDB migration is acknowledged', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lp-sentinel-indexeddb-'));
    const file = join(directory, 'state.json');
    try {
      await writeFile(file, JSON.stringify({ ...defaultState(), positions: [{ id: 'legacy-position' }] }));
      const store = new JsonStore(file, { positionStorage: 'indexeddb' });
      await store.load();
      await store.update((draft) => { draft.updatedAt = '2026-09-04T01:00:00.000Z'; });
      expect(JSON.parse(await readFile(file, 'utf8')).positions).toHaveLength(1);

      await store.completePositionMigration();
      expect(JSON.parse(await readFile(file, 'utf8')).positions).toEqual([]);
      expect(store.get().positions).toHaveLength(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
