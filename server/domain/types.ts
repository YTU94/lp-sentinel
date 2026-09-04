export type LpSourceId = 'robinhood-uniswap-v3' | 'bsc-pancake-v3';
export type AlertBoundary = 'lower' | 'upper';

export interface TokenInfo {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
}

export interface LivePositionSource {
  type: 'onchain-v3';
  sourceId: LpSourceId;
  chainId: number;
  networkName: string;
  protocol: string;
  tokenId: string;
  positionManager: `0x${string}`;
  poolAddress: `0x${string}`;
  explorerUrl: string;
}

export interface SnapshotPoint {
  blockNumber?: string;
  headBlockNumber?: string;
  blockLag?: number;
  blockTimestamp?: string;
  observedAt?: string;
  updatedAt: string;
  currentPrice: number;
  principalValueQuote: number;
  feeAmount0: number;
  feeAmount1: number;
}

export interface FeeApr {
  annualizedPercent: number;
  feesEarnedQuote: number;
  windowSeconds: number;
  sampleCount: number;
  fullWindow: boolean;
}

export interface OnchainPositionSnapshot extends SnapshotPoint {
  amount0: number;
  amount1: number;
  feeValueQuote: number;
  totalValueQuote: number;
  stale: boolean;
  error?: string;
}

export interface LiveLpPosition {
  source: LivePositionSource;
  owner: `0x${string}`;
  token0: TokenInfo;
  token1: TokenInfo;
  feeTier: number;
  tickSpacing: number;
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  liquidity: string;
  rangeLower: number;
  rangeUpper: number;
  currentPrice: number;
  snapshot: OnchainPositionSnapshot;
}

export interface AlertState {
  armed: boolean;
  lastBoundary: AlertBoundary | null;
}

export interface Position {
  id: string;
  name: string;
  enabled: boolean;
  source: LivePositionSource;
  owner: string;
  token0: TokenInfo;
  token1: TokenInfo;
  feeTier: number;
  tickSpacing: number;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  rangeLower: number;
  rangeUpper: number;
  alertLower: number;
  alertUpper: number;
  currentPrice: number | null;
  alertState: AlertState;
  snapshot: OnchainPositionSnapshot | null;
  history: SnapshotPoint[];
  feeApr1h: FeeApr | null;
  createdAt: string;
  lastError?: string;
}

export interface Settings {
  pollIntervalMs: number;
  notificationEnabled: boolean;
  dingEnabled: boolean;
  dingCallEnabled: boolean;
}

export interface AppState {
  schemaVersion: number;
  positions: Position[];
  settings: Settings;
  notification: { authenticated: boolean; user?: string; checkedAt?: string; error?: string };
  updatedAt: string;
}

export interface RuntimeCapabilities {
  mode: 'local' | 'vercel';
  persistent: boolean;
  backgroundMonitoring: boolean;
  notifications: boolean;
  notificationProvider: 'dws' | 'none';
  positionStorage: 'indexeddb';
}

export interface StoredLpPosition {
  id: string;
  sourceId: LpSourceId;
  tokenId: string;
  enabled: boolean;
  alertLower: number;
  alertUpper: number;
  alertState: AlertState;
  createdAt: string;
}
