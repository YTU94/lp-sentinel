import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startMonitor } from '../server/monitor.js';
import { JsonStore } from '../server/store.js';

describe('startMonitor', () => {
  afterEach(() => vi.useRealTimers());

  it('refreshes immediately and reschedules when settings change', async () => {
    vi.useFakeTimers();
    const directory = await mkdtemp(join(tmpdir(), 'lp-monitor-'));
    const store = new JsonStore(join(directory, 'state.json'));
    await store.load();
    const refresh = vi.fn(async () => store.get());
    const monitor = startMonitor(store, refresh);
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    await store.update((draft) => { draft.settings.pollIntervalMs = 5_000; });
    monitor.reschedule();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    monitor.stop();
    await rm(directory, { recursive: true, force: true });
  });
});
