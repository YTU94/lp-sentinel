import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { JsonStore } from '../server/store.js';

const store = new JsonStore(join(tmpdir(), 'lp-sentinel-vercel.json'), { positionStorage: 'indexeddb' });
await store.load();
await store.update((draft) => {
  draft.settings.notificationEnabled = false;
  draft.settings.dingEnabled = false;
  draft.settings.dingCallEnabled = false;
  draft.settings.dingRobotCode = '';
  draft.notification = { authenticated: false, error: 'Vercel 云端会话不接入本机 DWS' };
});

export default createApp({
  store,
  runtime: { mode: 'vercel', persistent: false, backgroundMonitoring: false, notifications: false, positionStorage: 'indexeddb' },
});
