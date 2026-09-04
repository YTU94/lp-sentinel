const TICK_BASE = 1.0001;
const UINT256_MOD = 2n ** 256n;
const Q128 = 2n ** 128n;

const subtractUint256 = (left: bigint, right: bigint) => (left - right + UINT256_MOD) % UINT256_MOD;

export function priceFromTick(tick: number, decimals0: number, decimals1: number): number {
  return TICK_BASE ** tick * 10 ** (decimals0 - decimals1);
}

export function priceFromSqrtPriceX96(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number {
  const sqrtRatio = Number(sqrtPriceX96) / 2 ** 96;
  return sqrtRatio ** 2 * 10 ** (decimals0 - decimals1);
}

export function amountsForLiquidityAtSqrtPrice(
  liquidity: bigint,
  tickLower: number,
  tickUpper: number,
  sqrtPriceX96: bigint,
  decimals0: number,
  decimals1: number,
): { amount0: number; amount1: number } {
  const sqrtLower = TICK_BASE ** (tickLower / 2);
  const sqrtUpper = TICK_BASE ** (tickUpper / 2);
  const sqrtCurrent = Number(sqrtPriceX96) / 2 ** 96;
  const L = Number(liquidity);
  let raw0 = 0;
  let raw1 = 0;
  if (sqrtCurrent <= sqrtLower) raw0 = L * (sqrtUpper - sqrtLower) / (sqrtLower * sqrtUpper);
  else if (sqrtCurrent >= sqrtUpper) raw1 = L * (sqrtUpper - sqrtLower);
  else {
    raw0 = L * (sqrtUpper - sqrtCurrent) / (sqrtCurrent * sqrtUpper);
    raw1 = L * (sqrtCurrent - sqrtLower);
  }
  return { amount0: raw0 / 10 ** decimals0, amount1: raw1 / 10 ** decimals1 };
}

export function amountsForLiquidity(
  liquidity: bigint,
  tickLower: number,
  tickUpper: number,
  currentTick: number,
  decimals0: number,
  decimals1: number,
): { amount0: number; amount1: number } {
  const sqrtPriceX96 = BigInt(Math.floor(TICK_BASE ** (currentTick / 2) * 2 ** 96));
  return amountsForLiquidityAtSqrtPrice(liquidity, tickLower, tickUpper, sqrtPriceX96, decimals0, decimals1);
}

export function uncollectedFeeAmount(input: {
  liquidity: bigint;
  currentTick: number;
  tickLower: number;
  tickUpper: number;
  feeGrowthGlobalX128: bigint;
  feeGrowthOutsideLowerX128: bigint;
  feeGrowthOutsideUpperX128: bigint;
  feeGrowthInsideLastX128: bigint;
  tokensOwed: bigint;
}): bigint {
  const below = input.currentTick >= input.tickLower
    ? input.feeGrowthOutsideLowerX128
    : subtractUint256(input.feeGrowthGlobalX128, input.feeGrowthOutsideLowerX128);
  const above = input.currentTick < input.tickUpper
    ? input.feeGrowthOutsideUpperX128
    : subtractUint256(input.feeGrowthGlobalX128, input.feeGrowthOutsideUpperX128);
  const inside = subtractUint256(subtractUint256(input.feeGrowthGlobalX128, below), above);
  const delta = subtractUint256(inside, input.feeGrowthInsideLastX128);
  return input.tokensOwed + input.liquidity * delta / Q128;
}
