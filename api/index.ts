import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { getDingTalkConfig } from '../server/services/dingtalk-notifier.js';
import { JsonStore } from '../server/store.js';

const store = new JsonStore(join(tmpdir(), 'lp-sentinel-vercel.json'), { positionStorage: 'indexeddb' });
await store.load();
const dingtalk = getDingTalkConfig();
const monitorToken = process.env.LP_SENTINEL_MONITOR_TOKEN?.trim();
const monitorTokenValid = Boolean(monitorToken && monitorToken.length >= 32);
const missing = [...dingtalk.missing, ...(monitorTokenValid ? [] : ['LP_SENTINEL_MONITOR_TOKEN'])];
const cloudNotifications = Boolean(dingtalk.config && monitorTokenValid);
await store.update((draft) => {
  draft.settings.notificationEnabled = cloudNotifications;
  draft.settings.dingEnabled = false;
  draft.settings.dingCallEnabled = false;
  draft.settings.dingRobotCode = '';
  draft.notification = cloudNotifications
    ? { authenticated: true, user: `Vercel 钉钉机器人 · ${dingtalk.config!.userIds.length} 位接收人` }
    : { authenticated: false, error: `Vercel 钉钉通知未配置：缺少 ${missing.join(', ')}` };
});

export default createApp({
  store,
  monitorToken,
  runtime: { mode: 'vercel', persistent: false, backgroundMonitoring: false, notifications: cloudNotifications, notificationProvider: cloudNotifications ? 'dingtalk-openapi' : 'none', positionStorage: 'indexeddb' },
});
