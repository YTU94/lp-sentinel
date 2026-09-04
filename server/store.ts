import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AppState } from './domain/types.js';

export const defaultState = (): AppState => ({
  schemaVersion: 2,
  positions: [],
  settings: {
    pollIntervalMs: 5_000,
    notificationEnabled: true,
    dingEnabled: false,
    dingCallEnabled: false,
    dingRobotCode: '',
  },
  notification: { authenticated: false },
  updatedAt: new Date().toISOString(),
});

export class JsonStore {
  private state: AppState = defaultState();
  private queue: Promise<void> = Promise.resolve();
  private persistPositions: boolean;

  constructor(private readonly file: string, private readonly options: { positionStorage?: 'json' | 'indexeddb' } = {}) {
    this.persistPositions = options.positionStorage !== 'indexeddb';
  }

  async load(): Promise<AppState> {
    try {
      const defaults = defaultState();
      const stored = JSON.parse(await readFile(this.file, 'utf8')) as Partial<AppState>;
      const legacy = (stored.schemaVersion || 0) < 2;
      const settings = { ...defaults.settings, ...stored.settings };
      if (legacy && settings.pollIntervalMs === 300_000) settings.pollIntervalMs = 5_000;
      this.state = { ...defaults, ...stored, schemaVersion: 2, settings };
      if (this.options.positionStorage === 'indexeddb') this.persistPositions = Boolean(stored.positions?.length);
      if (legacy) await this.persist(this.state);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await this.persist(this.state);
    }
    return this.get();
  }

  get(): AppState {
    return structuredClone(this.state);
  }

  async update(mutator: (draft: AppState) => void | Promise<void>): Promise<AppState> {
    let result = this.get();
    this.queue = this.queue.then(async () => {
      const draft = this.get();
      await mutator(draft);
      draft.updatedAt = new Date().toISOString();
      await this.persist(draft);
      this.state = draft;
      result = this.get();
    });
    await this.queue;
    return result;
  }

  async completePositionMigration(): Promise<void> {
    if (this.options.positionStorage !== 'indexeddb' || !this.persistPositions) return;
    this.persistPositions = false;
    this.queue = this.queue.then(() => this.persist(this.state));
    await this.queue;
  }

  private async persist(state: AppState): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    const persisted = this.persistPositions ? state : { ...state, positions: [] };
    await writeFile(temporary, `${JSON.stringify(persisted, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }
}
