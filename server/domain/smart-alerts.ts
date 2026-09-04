export interface SmartAlertRecommendation {
  lower: number;
  upper: number;
  bufferRatio: number;
  confirmations: number;
  sampleIntervalSeconds: number;
  cooldownSeconds: number;
}

export function recommendAlerts(rangeLower: number, rangeUpper: number): SmartAlertRecommendation {
  if (!(rangeLower > 0) || !(rangeUpper > rangeLower)) throw new Error('LP 区间无效');
  const relativeWidth = (rangeUpper - rangeLower) / ((rangeUpper + rangeLower) / 2);
  const bufferRatio = relativeWidth <= 0.25 ? 0.2 : relativeWidth >= 0.85 ? 0.08 : 0.125;
  const inset = (rangeUpper - rangeLower) * bufferRatio;
  return {
    lower: rangeLower + inset,
    upper: rangeUpper - inset,
    bufferRatio,
    confirmations: 3,
    sampleIntervalSeconds: 300,
    cooldownSeconds: 14_400,
  };
}
