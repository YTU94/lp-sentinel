import express, { type Express, type RequestHandler } from 'express';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { importLivePosition } from './domain/live-lp-import.js';
import type { LpSourceId } from './domain/types.js';
import { mountStaticApp } from './http/static-app.js';
import { refreshPositions, startMonitor } from './monitor.js';
import { lookupLpNft, readBySource, type LpLookupResult } from './services/lp-nft-registry.js';
import { readRobinhoodPosition } from './services/robinhood-v3.js';
import { readWalletPancakePositions } from './services/pancake-v3.js';
import { searchBinanceSymbols } from './services/binance-symbol-search.js';
import { getDwsAuthStatus } from './services/dws-auth.js';
import { JsonStore } from './store.js';

const validTokenId = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d*$/.test(value);
const asyncRoute = (handler: RequestHandler): RequestHandler => (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);

export function createApp(options: { store: JsonStore; lookup?: (tokenId: string) => Promise<LpLookupResult>; refresh?: () => Promise<unknown>; onSettingsChanged?: () => void }): Express {
  const app = express();
  const lookup = options.lookup || lookupLpNft;
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/state', (_request, response) => response.json({ ...options.store.get(), serverTime: new Date().toISOString() }));
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
    const live = result.matches.find((item) => item.source.sourceId === sourceId) || await readBySource(sourceId!, tokenId);
    const position = importLivePosition(live);
    await options.store.update((draft) => { draft.positions.push(position); });
    response.status(201).json(position);
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
    const allowed = ['pollIntervalMs', 'notificationEnabled', 'dingEnabled', 'dingCallEnabled', 'dingRobotCode'] as const;
    const state = await options.store.update((draft) => { for (const key of allowed) if (key in request.body) Object.assign(draft.settings, { [key]: request.body[key] }); if (draft.settings.pollIntervalMs < 5_000) draft.settings.pollIntervalMs = 5_000; });
    options.onSettingsChanged?.();
    response.json(state.settings);
  }));
  app.post('/api/refresh', asyncRoute(async (_request, response) => { response.json(await (options.refresh ? options.refresh() : refreshPositions(options.store))); }));
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => { console.error(error instanceof Error ? error.message : 'Unknown server error'); response.status(502).json({ error: '外部服务暂不可用，请稍后重试' }); });
  if (process.env.NODE_ENV === 'production') mountStaticApp(app);
  return app;
}

async function main() {
  const store = new JsonStore(resolve(process.env.LP_SENTINEL_DATA || 'data/lp-sentinel.json'));
  await store.load();
  store.update(async (draft) => { draft.notification = await getDwsAuthStatus(); }).catch(() => undefined);
  const monitor = startMonitor(store);
  const app = createApp({ store, refresh: monitor.refreshNow, onSettingsChanged: monitor.reschedule });
  const port = Number(process.env.LP_SENTINEL_PORT || 4317);
  app.listen(port, '127.0.0.1', () => console.log(`LP Sentinel running at http://127.0.0.1:${port}`));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
