import { describe, expect, it } from 'vitest';
import { amountsForLiquidity, amountsForLiquidityAtSqrtPrice, priceFromSqrtPriceX96, uncollectedFeeAmount } from '../server/domain/lp-math.js';

describe('amountsForLiquidity', () => {
  it('holds only token0 below range and only token1 above range', () => {
    const below = amountsForLiquidity(1n, -100, 100, -200, 18, 18);
    const above = amountsForLiquidity(1n, -100, 100, 200, 18, 18);
    expect(below.amount0).toBeGreaterThan(0);
    expect(below.amount1).toBe(0);
    expect(above.amount0).toBe(0);
    expect(above.amount1).toBeGreaterThan(0);
  });

  it('calculates fee growth inside with uint256 wrapping', () => {
    const q128 = 2n ** 128n;
    const amount = uncollectedFeeAmount({
      liquidity: 10n,
      currentTick: 0,
      tickLower: -100,
      tickUpper: 100,
      feeGrowthGlobalX128: 9n * q128,
      feeGrowthOutsideLowerX128: 2n * q128,
      feeGrowthOutsideUpperX128: 3n * q128,
      feeGrowthInsideLastX128: 1n * q128,
      tokensOwed: 7n,
    });
    expect(amount).toBe(37n);
  });

  it('uses sqrtPriceX96 for exact in-tick price and token composition', () => {
    const q96 = 2n ** 96n;
    expect(priceFromSqrtPriceX96(q96, 18, 18)).toBe(1);
    const exact = amountsForLiquidityAtSqrtPrice(10n ** 18n, -100, 100, q96, 18, 18);
    expect(exact.amount0).toBeCloseTo(exact.amount1, 12);
  });
});
