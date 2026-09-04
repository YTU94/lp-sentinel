import { describe, expect, it } from 'vitest';
import { calculateFeeApr1h } from '../server/domain/fee-apr.js';

describe('calculateFeeApr1h', () => {
  it('annualizes positive fee growth and ignores collection drops', () => {
    const now = Date.parse('2026-01-01T01:00:00Z');
    const result = calculateFeeApr1h([
      { updatedAt: new Date(now - 3600_000).toISOString(), currentPrice: 2, principalValueQuote: 1000, feeAmount0: 1, feeAmount1: 2 },
      { updatedAt: new Date(now - 1800_000).toISOString(), currentPrice: 2, principalValueQuote: 1000, feeAmount0: 2, feeAmount1: 3 },
      { updatedAt: new Date(now).toISOString(), currentPrice: 2, principalValueQuote: 1000, feeAmount0: 1, feeAmount1: 1 },
    ], now);
    expect(result?.feesEarnedQuote).toBe(3);
    expect(result?.fullWindow).toBe(true);
    expect(result?.annualizedPercent).toBeCloseTo(2628);
  });
});
