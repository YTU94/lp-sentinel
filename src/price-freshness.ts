export type FreshnessStatus = 'live' | 'delayed' | 'stale';

export interface FreshnessSnapshot {
  updatedAt: string;
  observedAt?: string;
  blockTimestamp?: string;
  blockLag?: number;
  stale?: boolean;
  error?: string;
}

export function priceFreshness(snapshot?: FreshnessSnapshot | null, now = Date.now()) {
  if (!snapshot) return { status: 'stale' as const, stale: true, label: '无快照', ageMs: Number.POSITIVE_INFINITY };
  const observedAt = snapshot.observedAt || snapshot.updatedAt;
  const ageMs = now - Date.parse(observedAt);
  const blockAgeMs = snapshot.blockTimestamp ? now - Date.parse(snapshot.blockTimestamp) : undefined;
  const effectiveAgeMs = blockAgeMs == null ? ageMs : Math.max(ageMs, blockAgeMs);
  const blockLag = snapshot.blockLag;
  if (snapshot.stale || snapshot.error || !Number.isFinite(effectiveAgeMs) || effectiveAgeMs > 10 * 60_000) {
    return { status: 'stale' as const, stale: true, label: '数据已过期', ageMs: effectiveAgeMs, blockLag };
  }
  const live = blockAgeMs == null
    ? ageMs <= 60_000 && (blockLag == null || blockLag <= 5)
    : effectiveAgeMs <= 30_000;
  if (live) {
    return { status: 'live' as const, stale: false, label: '链上实时', ageMs: effectiveAgeMs, blockLag };
  }
  const label = blockLag != null && blockLag > 5
    ? `链上延迟 · 落后 ${blockLag} 块`
    : effectiveAgeMs < 60_000 ? '链上延迟' : `${Math.floor(effectiveAgeMs / 60_000)} 分钟前`;
  return { status: 'delayed' as const, stale: false, label, ageMs: effectiveAgeMs, blockLag };
}
