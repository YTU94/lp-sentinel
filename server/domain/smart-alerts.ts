export interface SmartAlertInput {
  tickLower: number;
  tickUpper: number;
  tickSpacing: number;
  decimals0: number;
  decimals1: number;
}

export interface SmartAlertRecommendation {
  alertLower: number;
  alertUpper: number;
  warningLowerTick: number;
  warningUpperTick: number;
  bufferRatio: number;
  confirmations: number;
  pollIntervalSeconds: number;
  cooldownSeconds: number;
}

export function tickToPrice(tick: number, decimals0: number, decimals1: number) {
  return Math.pow(1.0001, tick) * Math.pow(10, decimals0 - decimals1);
}

export function suggestAlertThresholds(input: SmartAlertInput): SmartAlertRecommendation {
  const span = input.tickUpper - input.tickLower;
  if (!Number.isInteger(input.tickSpacing) || input.tickSpacing <= 0) throw new Error("tickSpacing 必须大于 0");
  if (!Number.isInteger(span) || span < input.tickSpacing * 4) throw new Error("LP tick 区间过窄，无法生成安全预警线");

  const bufferRatio = span <= 600 ? 0.2 : span <= 1_800 ? 0.125 : 0.08;
  const roundedBuffer = Math.round((span * bufferRatio) / input.tickSpacing) * input.tickSpacing;
  const maximumBuffer = Math.floor(span / input.tickSpacing / 4) * input.tickSpacing;
  const buffer = Math.min(maximumBuffer, Math.max(input.tickSpacing, roundedBuffer));
  const warningLowerTick = input.tickLower + buffer;
  const warningUpperTick = input.tickUpper - buffer;

  return {
    alertLower: tickToPrice(warningLowerTick, input.decimals0, input.decimals1),
    alertUpper: tickToPrice(warningUpperTick, input.decimals0, input.decimals1),
    warningLowerTick,
    warningUpperTick,
    bufferRatio,
    confirmations: 3,
    pollIntervalSeconds: 300,
    cooldownSeconds: 14_400,
  };
}
