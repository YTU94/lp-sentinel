export type AlertThresholdSide = "lower" | "upper";

export interface AlertThresholdRange {
  lowerPrice: number;
  upperPrice: number;
  alertLower: number;
  alertUpper: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function priceToPercent(price: number, lowerPrice: number, upperPrice: number) {
  if (upperPrice <= lowerPrice) return 0;
  return clamp(((price - lowerPrice) / (upperPrice - lowerPrice)) * 100, 0, 100);
}

export function percentToPrice(value: number, lowerPrice: number, upperPrice: number) {
  const percent = clamp(value, 0, 100);
  return lowerPrice + (upperPrice - lowerPrice) * (percent / 100);
}

export function thresholdStep(lowerPrice: number, upperPrice: number) {
  return Math.max(Number.EPSILON, (upperPrice - lowerPrice) * 0.005);
}

export function clampAlertThreshold(side: AlertThresholdSide, value: number, range: AlertThresholdRange) {
  const gap = thresholdStep(range.lowerPrice, range.upperPrice);
  return side === "lower"
    ? clamp(value, range.lowerPrice, range.alertUpper - gap)
    : clamp(value, range.alertLower + gap, range.upperPrice);
}
