import type { StoredLpPosition } from './indexeddb-position-store';
import type { AppState, LiveLpPosition, LpLookup, LpSourceId, Position, Settings } from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  if (!response.ok) { const body = await response.json().catch(() => ({})) as { error?: string }; throw new Error(body.error || `请求失败 (${response.status})`); }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  state: () => request<AppState>('/api/state'),
  lookupNft: (tokenId: string) => request<LpLookup>(`/api/lp-nft/${encodeURIComponent(tokenId)}`),
  importNft: (tokenId: string, sourceId: LpSourceId) => request<Position>('/api/positions/from-lp-nft', { method: 'POST', body: JSON.stringify({ tokenId, sourceId }) }),
  syncPositions: (positions: StoredLpPosition[]) => request<{ positions: Position[] }>('/api/positions/sync', { method: 'PUT', body: JSON.stringify({ positions }) }),
  setEnabled: (id: string, enabled: boolean) => request<Position>(`/api/positions/${id}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  setAlerts: (id: string, lower: number, upper: number) => request<Position>(`/api/positions/${id}/alerts`, { method: 'PATCH', body: JSON.stringify({ lower, upper }) }),
  remove: (id: string) => request<void>(`/api/positions/${id}`, { method: 'DELETE' }),
  settings: (settings: Partial<Settings>) => request<Settings>('/api/settings', { method: 'PATCH', body: JSON.stringify(settings) }),
  testNotification: (monitorToken: string) => request<{ sent: true }>('/api/notifications/test', { method: 'POST', headers: { authorization: `Bearer ${monitorToken}` } }),
  refresh: (positions?: StoredLpPosition[], monitorToken?: string) => request<AppState>('/api/refresh', { method: 'POST', headers: monitorToken ? { authorization: `Bearer ${monitorToken}` } : undefined, body: JSON.stringify(positions ? { positions } : {}) }),
  walletPositions: (address: string) => request<{ positions: LiveLpPosition[]; discovery: string }>(`/api/wallet/${address}/pancake-v3`),
};
