export type RangeStatus = "below" | "in-range" | "above";

interface PositionInput {
  capitalQuote: number;
  currentPrice: number;
  referencePrice: number;
  lowerPrice: number;
  upperPrice: number;
}

export interface SimulatedPosition {
  baseAmount: number;
  quoteAmount: number;
  valueQuote: number;
  status: RangeStatus;
  progress: number;
}

function assertPositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label}必须大于 0`);
  }
}

export function simulateConcentratedPosition(input: PositionInput): SimulatedPosition {
  assertPositive(input.capitalQuote, "模拟投入");
  assertPositive(input.currentPrice, "当前价格");
  assertPositive(input.referencePrice, "建仓价格");
  assertPositive(input.lowerPrice, "区间下限");
  assertPositive(input.upperPrice, "区间上限");

  if (input.lowerPrice >= input.upperPrice) {
    throw new Error("区间下限必须小于上限");
  }

  const sqrtLower = Math.sqrt(input.lowerPrice);
  const sqrtUpper = Math.sqrt(input.upperPrice);
  const boundedReference = Math.min(input.upperPrice, Math.max(input.lowerPrice, input.referencePrice));
  const sqrtReference = Math.sqrt(boundedReference);

  const referenceBasePerLiquidity = (sqrtUpper - sqrtReference) / (sqrtReference * sqrtUpper);
  const referenceQuotePerLiquidity = sqrtReference - sqrtLower;
  const liquidity = input.capitalQuote
    / (referenceBasePerLiquidity * boundedReference + referenceQuotePerLiquidity);

  let baseAmount: number;
  let quoteAmount: number;
  let status: RangeStatus;

  if (input.currentPrice <= input.lowerPrice) {
    status = "below";
    baseAmount = liquidity * (sqrtUpper - sqrtLower) / (sqrtLower * sqrtUpper);
    quoteAmount = 0;
  } else if (input.currentPrice >= input.upperPrice) {
    status = "above";
    baseAmount = 0;
    quoteAmount = liquidity * (sqrtUpper - sqrtLower);
  } else {
    status = "in-range";
    const sqrtCurrent = Math.sqrt(input.currentPrice);
    baseAmount = liquidity * (sqrtUpper - sqrtCurrent) / (sqrtCurrent * sqrtUpper);
    quoteAmount = liquidity * (sqrtCurrent - sqrtLower);
  }

  return {
    baseAmount,
    quoteAmount,
    valueQuote: baseAmount * input.currentPrice + quoteAmount,
    status,
    progress: Math.min(1, Math.max(0, (input.currentPrice - input.lowerPrice) / (input.upperPrice - input.lowerPrice))),
  };
}
