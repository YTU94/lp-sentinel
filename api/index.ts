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
  draft.notification = { authenticated: false, error: 'DWS CLI 认证仅适用于本地运行，Vercel 无法继承本机登录态' };
});

export default createApp({
  store,
  runtime: { mode: 'vercel', persistent: false, backgroundMonitoring: false, notifications: false, notificationProvider: 'none', positionStorage: 'indexeddb' },
});
