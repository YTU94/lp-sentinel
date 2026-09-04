export type LpSourceId = 'robinhood-uniswap-v3' | 'bsc-pancake-v3';
export type ActionStage = 'safe' | 'warning' | 'execute' | 'cooldown';
export type ActionStatus = ActionStage | 'stale';

export interface TokenInfo { address: `0x${string}`; symbol: string; decimals: number }
export interface SnapshotPoint { blockNumber?: string; headBlockNumber?: string; blockLag?: number; blockTimestamp?: string; observedAt?: string; updatedAt: string; currentPrice: number; principalValueQuote: number; feeAmount0: number; feeAmount1: number }
export interface LiveLpPosition {
  source: { type: 'onchain-v3'; sourceId: LpSourceId; chainId: number; networkName: string; protocol: string; tokenId: string; positionManager: `0x${string}`; poolAddress: `0x${string}`; explorerUrl: string };
  owner: `0x${string}`;
  token0: TokenInfo; token1: TokenInfo; feeTier: number; tickSpacing: number; tickLower: number; tickUpper: number; currentTick: number; liquidity: string;
  rangeLower: number; rangeUpper: number; currentPrice: number;
  snapshot: SnapshotPoint & { amount0: number; amount1: number; feeValueQuote: number; totalValueQuote: number; stale: boolean; error?: string };
}
export interface Position extends Omit<LiveLpPosition, 'currentTick' | 'currentPrice'> {
  id: string; name: string; enabled: boolean; currentPrice: number | null; alertLower: number; alertUpper: number;
  alertState: { armed: boolean; lastBoundary: 'lower' | 'upper' | null };
  history: SnapshotPoint[]; feeApr1h: { annualizedPercent: number; feesEarnedQuote: number; windowSeconds: number; sampleCount: number; fullWindow: boolean } | null;
  createdAt: string; lastError?: string;
}
export interface Settings { pollIntervalMs: number; notificationEnabled: boolean; dingEnabled: boolean; dingCallEnabled: boolean }
export interface RuntimeCapabilities { mode: 'local' | 'vercel'; persistent: boolean; backgroundMonitoring: boolean; notifications: boolean; notificationProvider: 'dws' | 'none'; positionStorage: 'indexeddb' }
export interface AppState { schemaVersion: number; positions: Position[]; settings: Settings; notification: { authenticated: boolean; user?: string; checkedAt?: string; error?: string }; runtime: RuntimeCapabilities; updatedAt: string; serverTime: string }
export interface LpLookup { matches: LiveLpPosition[]; probes: Array<{ sourceId: LpSourceId; networkName: string; protocol: string; status: 'found' | 'not_found' | 'unavailable'; message: string }> }
