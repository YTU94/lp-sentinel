import express, { type Express, type RequestHandler } from 'express';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { importLivePosition } from './domain/live-lp-import.js';
import type { LpSourceId, RuntimeCapabilities, StoredLpPosition } from './domain/types.js';
import { mountStaticApp } from './http/static-app.js';
import { refreshPositions, startMonitor } from './monitor.js';
import { lookupLpNft, readBySource, type LpLookupResult } from './services/lp-nft-registry.js';
import { readRobinhoodPosition } from './services/robinhood-v3.js';
import { readWalletPancakePositions } from './services/pancake-v3.js';
import { searchBinanceSymbols } from './services/binance-symbol-search.js';
import { getDwsAuthStatus, type DwsAuthStatus } from './services/dws-auth.js';
import { sendDwsTestNotification } from './services/dws-notifier.js';
import { JsonStore } from './store.js';

const validTokenId = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d*$/.test(value);
const asyncRoute = (handler: RequestHandler): RequestHandler => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);

export function createApp(options: { store: JsonStore; lookup?: (tokenId: string) => Promise<LpLookupResult>; readPosition?: typeof readBySource; refresh?: () => Promise<unknown>; getAuthStatus?: () => Promise<DwsAuthStatus>; testNotification?: () => Promise<void>; onSettingsChanged?: () => void; runtime?: RuntimeCapabilities }): Express {
  const app = express();
  const lookup = options.lookup || lookupLpNft;
  const readPosition = options.readPosition || readBySource;
  const getAuthStatus = options.getAuthStatus || getDwsAuthStatus;
  const runtime: RuntimeCapabilities = options.runtime || { mode: 'local', persistent: true, backgroundMonitoring: true, notifications: true, notificationProvider: 'dws', positionStorage: 'indexeddb' };
  const hydratePositions = async (records: StoredLpPosition[]) => {
    const unique = [...new Map(records.map((record) => [`${record.sourceId}:${record.tokenId}`, record])).values()];
    const existing = options.store.get().positions;
    const positions = await Promise.all(unique.map(async (record) => {
      const current = existing.find((position) => position.source.sourceId === record.sourceId && position.source.tokenId === record.tokenId);
      const position = current || importLivePosition(await readPosition(record.sourceId, record.tokenId));
      const alertsValid = record.alertLower > position.rangeLower && record.alertUpper < position.rangeUpper && record.alertLower < record.alertUpper;
      return {
        ...position,
        id: record.id,
        enabled: record.enabled,
        alertLower: alertsValid ? record.alertLower : position.alertLower,
        alertUpper: alertsValid ? record.alertUpper : position.alertUpper,
        alertState: alertsValid ? record.alertState : { armed: true, lastBoundary: null },
        createdAt: record.createdAt,
      };
    }));
    await options.store.update((draft) => { draft.positions = positions; });
    await options.store.completePositionMigration();
    return positions;
  };
  app.use(express.json({ limit: '64kb' }));
  app.use('/api', (_request, response, next) => { response.set('Cache-Control', 'no-store'); next(); });

  app.get('/api/state', (_request, response) => response.json({ ...options.store.get(), runtime, serverTime: new Date().toISOString() }));
  app.get('/api/tokens/search', asyncRoute(async (request, response) => response.json({ symbols: await searchBinanceSymbols(String(request.query.q || '')) })));
  app.get('/api/lp-nft/:tokenId', asyncRoute(async (request, response) => {
    if (!validTokenId(request.params.tokenId)) return void response.status(400).json({ error: 'NFT ID 必须是正整数' });
    response.json(await lookup(request.params.tokenId));
  }));
  app.get('/api/lp/robinhood-uniswap-v3/:tokenId', asyncRoute(async (request, response) => {
    const tokenId = String(request.params.tokenId);
    if (!validTokenId(tokenId)) return void response.status(400).json({ error: 'NFT ID 必须是正整数' });
    response.json(await readRobinhoodPosition(tokenId));
  }));
  app.get('/api/wallet/:address/pancake-v3', asyncRoute(async (request, response) => {
    const address = String(request.params.address);
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) return void response.status(400).json({ error: '钱包地址无效' });
    response.json(await readWalletPancakePositions(address));
  }));
  app.post('/api/positions/from-lp-nft', asyncRoute(async (request, response) => {
    const { tokenId, sourceId } = request.body as { tokenId?: string; sourceId?: LpSourceId };
    if (!validTokenId(tokenId) || !['robinhood-uniswap-v3', 'bsc-pancake-v3'].includes(String(sourceId))) return void response.status(400).json({ error: '必须提供有效的 tokenId 与 sourceId' });
    if (options.store.get().positions.some((item) => item.source.tokenId === tokenId && item.source.sourceId === sourceId)) return void response.status(409).json({ error: '该仓位已在监控中' });
    const result = await lookup(tokenId);
    const live = result.matches.find((item) => item.source.sourceId === sourceId) || await readPosition(sourceId!, tokenId);
    const position = importLivePosition(live);
    await options.store.update((draft) => { draft.positions.push(position); });
    response.status(201).json(position);
  }));
  app.put('/api/positions/sync', asyncRoute(async (request, response) => {
    const records = (request.body as { positions?: unknown }).positions;
    if (!Array.isArray(records) || records.length > 100 || !records.every(isStoredLpPosition)) return void response.status(400).json({ error: 'IndexedDB 仓位数据无效' });
    response.json({ positions: await hydratePositions(records as StoredLpPosition[]) });
  }));
  app.patch('/api/positions/:id/enabled', asyncRoute(async (request, response) => {
    if (typeof request.body.enabled !== 'boolean') return void response.status(400).json({ error: 'enabled 必须是布尔值' });
    let found = false;
    const state = await options.store.update((draft) => { const item = draft.positions.find((position) => position.id === request.params.id); if (item) { item.enabled = request.body.enabled; found = true; } });
    response.status(found ? 200 : 404).json(found ? state.positions.find((item) => item.id === request.params.id) : { error: '仓位不存在' });
  }));
  app.patch('/api/positions/:id/alerts', asyncRoute(async (request, response) => {
    const lower = Number(request.body.lower); const upper = Number(request.body.upper);
    let status = 404;
    const state = await options.store.update((draft) => { const item = draft.positions.find((position) => position.id === request.params.id); if (!item) return; if (!(lower > item.rangeLower && upper < item.rangeUpper && lower < upper)) { status = 400; return; } item.alertLower = lower; item.alertUpper = upper; item.alertState = { armed: true, lastBoundary: null }; status = 200; });
    response.status(status).json(status === 200 ? state.positions.find((item) => item.id === request.params.id) : { error: status === 400 ? '预警线必须位于 LP 区间内且下限小于上限' : '仓位不存在' });
  }));
  app.delete('/api/positions/:id', asyncRoute(async (request, response) => {
    let removed = false;
    await options.store.update((draft) => { const before = draft.positions.length; draft.positions = draft.positions.filter((item) => item.id !== request.params.id); removed = draft.positions.length < before; });
    response.status(removed ? 204 : 404).end();
  }));
  app.patch('/api/settings', asyncRoute(async (request, response) => {
    const allowed = ['pollIntervalMs', 'notificationEnabled', 'dingEnabled', 'dingCallEnabled'] as const;
    const state = await options.store.update((draft) => {
      for (const key of allowed) if (key in request.body) Object.assign(draft.settings, { [key]: request.body[key] });
      if (draft.settings.pollIntervalMs < 5_000) draft.settings.pollIntervalMs = 5_000;
      if (!runtime.notifications) Object.assign(draft.settings, { notificationEnabled: false, dingEnabled: false, dingCallEnabled: false });
    });
    options.onSettingsChanged?.();
    response.json(state.settings);
  }));
  app.get('/api/notifications/auth', asyncRoute(async (_request, response) => {
    if (!runtime.notifications || runtime.notificationProvider !== 'dws') return void response.status(503).json({ error: 'DWS CLI 认证仅支持本地运行' });
    const status = await getAuthStatus();
    await options.store.update((draft) => { draft.notification = status; });
    response.json(status);
  }));
  app.post('/api/notifications/test', asyncRoute(async (_request, response) => {
    if (!runtime.notifications || runtime.notificationProvider !== 'dws') return void response.status(503).json({ error: 'DWS CLI 通知仅支持本地运行' });
    const status = await getAuthStatus();
    await options.store.update((draft) => { draft.notification = status; });
    if (!status.authenticated) return void response.status(409).json({ error: status.error || 'DWS CLI 未登录，请执行 dws auth login' });
    await (options.testNotification || sendDwsTestNotification)();
    response.json({ sent: true });
  }));
  app.post('/api/refresh', asyncRoute(async (request, response) => {
    if (runtime.mode === 'vercel') {
      const records = (request.body as { positions?: unknown }).positions;
      if (!Array.isArray(records) || records.length > 100 || !records.every(isStoredLpPosition)) return void response.status(400).json({ error: 'Vercel 刷新需要有效的 IndexedDB 仓位数据' });
      await hydratePositions(records as StoredLpPosition[]);
    }
    response.json(await (options.refresh ? options.refresh() : refreshPositions(options.store)));
  }));
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => { console.error(error instanceof Error ? error.message : 'Unknown server error'); response.status(502).json({ error: '外部服务暂不可用，请稍后重试' }); });
  if (process.env.NODE_ENV === 'production') mountStaticApp(app);
  return app;
}

async function main() {
  const store = new JsonStore(resolve(process.env.LP_SENTINEL_DATA || 'data/lp-sentinel.json'), { positionStorage: 'indexeddb' });
  await store.load();
  store.update(async (draft) => { draft.notification = await getDwsAuthStatus(); }).catch(() => undefined);
  const monitor = startMonitor(store);
  const app = createApp({ store, refresh: monitor.refreshNow, onSettingsChanged: monitor.reschedule });
  const port = Number(process.env.LP_SENTINEL_PORT || 4317);
  app.listen(port, '127.0.0.1', () => console.log(`LP Sentinel running at http://127.0.0.1:${port}`));
}

function isStoredLpPosition(value: unknown): value is StoredLpPosition {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<StoredLpPosition>;
  const boundary = record.alertState?.lastBoundary;
  return typeof record.id === 'string' && record.id.length > 0 && record.id.length <= 128
    && ['robinhood-uniswap-v3', 'bsc-pancake-v3'].includes(String(record.sourceId))
    && validTokenId(record.tokenId)
    && typeof record.enabled === 'boolean'
    && Number.isFinite(record.alertLower) && Number.isFinite(record.alertUpper)
    && typeof record.alertState?.armed === 'boolean' && (boundary === null || boundary === 'lower' || boundary === 'upper')
    && typeof record.createdAt === 'string' && Number.isFinite(Date.parse(record.createdAt));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
