import type { LiveLpPosition, LpSourceId } from '../domain/types.js';
import { readPancakePosition } from './pancake-v3.js';
import { readRobinhoodPosition } from './robinhood-v3.js';
import { PositionNotFoundError } from './v3-reader.js';

export interface LpProbe { sourceId: LpSourceId; networkName: string; protocol: string; status: 'found' | 'not_found' | 'unavailable'; message: string }
export interface LpLookupResult { matches: LiveLpPosition[]; probes: LpProbe[] }

export const lpNftAdapters = [
  { sourceId: 'robinhood-uniswap-v3' as const, networkName: 'Robinhood Chain', protocol: 'Uniswap V3', read: readRobinhoodPosition },
  { sourceId: 'bsc-pancake-v3' as const, networkName: 'BNB Chain', protocol: 'PancakeSwap V3', read: readPancakePosition },
];

export async function lookupLpNft(tokenId: string): Promise<LpLookupResult> {
  const results = await Promise.all(lpNftAdapters.map(async (adapter) => {
    try {
      return { match: await adapter.read(tokenId), probe: { sourceId: adapter.sourceId, networkName: adapter.networkName, protocol: adapter.protocol, status: 'found' as const, message: '已识别' } };
    } catch (error) {
      const notFound = error instanceof PositionNotFoundError;
      return { match: null, probe: { sourceId: adapter.sourceId, networkName: adapter.networkName, protocol: adapter.protocol, status: notFound ? 'not_found' as const : 'unavailable' as const, message: notFound ? '未找到此 NFT' : 'RPC 暂不可用，请稍后重试' } };
    }
  }));
  return { matches: results.flatMap((item) => item.match ? [item.match] : []), probes: results.map((item) => item.probe) };
}

export async function readBySource(sourceId: LpSourceId, tokenId: string) {
  const adapter = lpNftAdapters.find((item) => item.sourceId === sourceId);
  if (!adapter) throw new Error('不支持的 LP 来源');
  return adapter.read(tokenId);
}
