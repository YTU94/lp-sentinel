import type { FeeApr1h, OnchainFeeSample, OnchainPositionSnapshot } from "./position.js";

const ONE_HOUR_MS = 60 * 60 * 1_000;
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;
const MIN_SAMPLE_WINDOW_MS = 60 * 1_000;

export function feeSampleFromSnapshot(snapshot: OnchainPositionSnapshot, currentPrice: number): OnchainFeeSample {
  return {
    blockNumber: snapshot.blockNumber,
    updatedAt: snapshot.updatedAt,
    currentPrice,
    principalValueQuote: snapshot.principalValueQuote,
    feeAmount0: snapshot.unclaimedFees[0].amount,
    feeAmount1: snapshot.unclaimedFees[1].amount,
  };
}

export function updateFeeApr1h(
  existingHistory: OnchainFeeSample[] | undefined,
  sample: OnchainFeeSample,
): { history: OnchainFeeSample[]; feeApr1h?: FeeApr1h } {
  const sampleTime = Date.parse(sample.updatedAt);
  const history = [...(existingHistory ?? [])]
    .filter((item) => Number.isFinite(Date.parse(item.updatedAt)))
    .filter((item) => item.blockNumber !== sample.blockNumber);
  history.push(sample);
  history.sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt));

  const windowStart = sampleTime - ONE_HOUR_MS;
  const window = history.filter((item) => Date.parse(item.updatedAt) >= windowStart).slice(-900);
  if (window.length < 2) return { history: window };

  const firstTime = Date.parse(window[0].updatedAt);
  const lastTime = Date.parse(window.at(-1)!.updatedAt);
  const elapsedMs = lastTime - firstTime;
  if (elapsedMs < MIN_SAMPLE_WINDOW_MS) return { history: window };

  let feesEarnedQuote = 0;
  let principalTimeValue = 0;
  for (let index = 1; index < window.length; index += 1) {
    const previous = window[index - 1];
    const current = window[index];
    const intervalMs = Date.parse(current.updatedAt) - Date.parse(previous.updatedAt);
    if (intervalMs <= 0) continue;
    const baseFeeGrowth = Math.max(0, current.feeAmount0 - previous.feeAmount0);
    const quoteFeeGrowth = Math.max(0, current.feeAmount1 - previous.feeAmount1);
    feesEarnedQuote += baseFeeGrowth * current.currentPrice + quoteFeeGrowth;
    principalTimeValue += ((previous.principalValueQuote + current.principalValueQuote) / 2) * intervalMs;
  }

  const averagePrincipal = principalTimeValue / elapsedMs;
  if (!Number.isFinite(averagePrincipal) || averagePrincipal <= 0) return { history: window };
  const windowSeconds = elapsedMs / 1_000;
  return {
    history: window,
    feeApr1h: {
      annualizedPercent: feesEarnedQuote / averagePrincipal * (ONE_YEAR_SECONDS / windowSeconds) * 100,
      feesEarnedQuote,
      windowSeconds,
      sampleCount: window.length,
      fullWindow: elapsedMs >= ONE_HOUR_MS,
    },
  };
}
