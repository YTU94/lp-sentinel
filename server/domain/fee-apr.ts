import type { FeeApr, SnapshotPoint } from './types.js';

export function calculateFeeApr1h(history: SnapshotPoint[], now = Date.now()): FeeApr | null {
  const samples = history
    .filter((item) => Number.isFinite(Date.parse(item.updatedAt)) && Date.parse(item.updatedAt) >= now - 3_600_000)
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
  if (samples.length < 2) return null;
  let fees = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const delta0 = current.feeAmount0 - previous.feeAmount0;
    const delta1 = current.feeAmount1 - previous.feeAmount1;
    if (delta0 >= 0 && delta1 >= 0) fees += delta0 * current.currentPrice + delta1;
  }
  const firstAt = Date.parse(samples[0].updatedAt);
  const lastAt = Date.parse(samples.at(-1)!.updatedAt);
  const windowSeconds = Math.max(1, (lastAt - firstAt) / 1000);
  let weightedPrincipal = 0;
  let weightedSeconds = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const seconds = (Date.parse(samples[index].updatedAt) - Date.parse(samples[index - 1].updatedAt)) / 1000;
    weightedPrincipal += ((samples[index - 1].principalValueQuote + samples[index].principalValueQuote) / 2) * seconds;
    weightedSeconds += seconds;
  }
  const principal = weightedSeconds ? weightedPrincipal / weightedSeconds : 0;
  return {
    annualizedPercent: principal > 0 ? (fees / principal) * (31_536_000 / windowSeconds) * 100 : 0,
    feesEarnedQuote: fees,
    windowSeconds,
    sampleCount: samples.length,
    fullWindow: now - firstAt >= 3_600_000,
  };
}
