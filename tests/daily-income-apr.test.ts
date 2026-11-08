import { afterEach, describe, expect, it, vi } from "vitest";
import { addDailyIncomeApr, calculateRangeActivity, type DailyIncomeSample } from "../server/domain/range-activity.js";
import { readRevertPositionHistory } from "../server/services/revert-portfolio.js";
import type { PortfolioPosition } from "../shared/portfolio.js";

vi.mock("../server/services/range-activity-replay.js", () => ({ backfillRangeActivity: async (_position: unknown, activity: unknown) => activity }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

const sample = (at: string, overrides: Partial<DailyIncomeSample> = {}): DailyIncomeSample => ({ at, principalUsd: 1000, fees0: 0, fees1: 0, price0Usd: 2000, price1Usd: 1, rewards: {}, ...overrides });
const activity = (samples: DailyIncomeSample[]) => addDailyIncomeApr(calculateRangeActivity({
  positionKey: "test", createdAt: samples[0].at, asOf: samples.at(-1)!.at, downsampled: false,
  snapshots: samples.map(point => ({ at: point.at, inRange: true, active: true })),
}), samples);

describe("daily income APR", () => {
  it("combines fees and rewards over the time-weighted principal without extrapolating a partial day", () => {
    const result = activity([
      sample("2026-11-07T16:00:00Z"),
      sample("2026-11-07T17:00:00Z", { fees1: 2 }),
      sample("2026-11-07T19:00:00Z", { principalUsd: 4000, fees1: 6, rewards: { reward: { amount: 2, priceUsd: 2 } } }),
    ]).days[0].income;
    expect(result).toMatchObject({ feesUsd: 6, rewardsUsd: 4, averagePrincipalUsd: 2000, sampledSeconds: 10800 });
    expect(result?.annualizedPercent).toBeCloseTo(182.5);
  });

  it("splits a midnight interval by Beijing date and interpolates its principal", () => {
    const result = activity([
      sample("2026-11-06T15:00:00Z"),
      sample("2026-11-06T17:00:00Z", { principalUsd: 2000, fees1: 2 }),
    ]);
    expect(result.days.map(day => [day.date, day.income?.feesUsd, day.income?.averagePrincipalUsd])).toEqual([
      ["2026-11-06", 1, 1250], ["2026-11-07", 1, 1750],
    ]);
  });

  it("does not count price appreciation of previously earned tokens as new income", () => {
    const result = activity([
      sample("2026-11-07T16:00:00Z", { fees0: 1, rewards: { reward: { amount: 10, priceUsd: 2 } } }),
      sample("2026-11-07T17:00:00Z", { fees0: 1, price0Usd: 4000, rewards: { reward: { amount: 10, priceUsd: 20 } } }),
    ]).days[0].income;
    expect(result?.annualizedPercent).toBe(0);
    expect(result?.feesUsd).toBe(0);
    expect(result?.rewardsUsd).toBe(0);
  });

  it("leaves missing, invalid, zero-capital and widely spaced samples unavailable", () => {
    for (const next of [
      sample("2026-11-07T20:00:00Z", { fees1: 1 }),
      sample("2026-11-07T17:00:00Z", { fees1: -1 }),
      sample("2026-11-07T17:00:00Z", { principalUsd: NaN }),
      sample("2026-11-07T17:00:00Z", { rewards: undefined }),
      sample("2026-11-07T17:00:00Z", { rewards: { reward: { amount: 1 } } }),
    ]) expect(activity([sample("2026-11-07T16:00:00Z"), next]).days[0].income).toBeUndefined();
    expect(activity([sample("2026-11-07T16:00:00Z", { principalUsd: 0 }), sample("2026-11-07T17:00:00Z", { principalUsd: 0 })]).days[0].income).toBeUndefined();
  });

  it("skips a counter reset and resumes only from a valid subsequent baseline", () => {
    const result = activity([
      sample("2026-11-07T16:00:00Z", { fees1: 10 }),
      sample("2026-11-07T17:00:00Z", { fees1: 5 }),
      sample("2026-11-07T18:00:00Z", { fees1: 6 }),
    ]).days[0].income;
    expect(result).toMatchObject({ feesUsd: 1, sampledSeconds: 3600 });
    expect(result?.annualizedPercent).toBeCloseTo(36.5);
  });

  it.each(["rewards", "none", "missing"])("maps Revert counters with %s reward data into the range response", async mode => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-08T03:00:00Z"));
    const token0 = "0x2222222222222222222222222222222222222222", token1 = "0x3333333333333333333333333333333333333333", reward = "0x4444444444444444444444444444444444444444";
    const position = { key: "base-aerodrome:revert:aero:1", tokenId: "1", chainId: 8453, pool: "0x1111111111111111111111111111111111111111", token0: { address: token0 }, token1: { address: token1 }, updatedAt: "2026-11-08T02:00:00Z", status: "in-range" } as PortfolioPosition;
    const rows = ["2026-11-07T16:00:00Z", "2026-11-07T18:00:00Z"].map((at, index) => ({
      block_ts: at, network: "base", exchange: "aero", nft_id: "1", pool_address: position.pool, token0_address: token0, token1_address: token1,
      in_range: true, exited: false, underlying_value: "1000", total_fees0: index * .01, total_fees1: index,
      total_rewards: mode === "none" ? null : mode === "missing" ? undefined : { [reward]: index * .5 }, prices: { token0: { usd: 100, token1: 100 }, token1: { usd: 1 }, rewards: { [reward]: { usd: 2 } } },
    }));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: { position_id: { network: "base", exchange: "aero", nft_id: "1" }, first_mint_ts: Date.parse(rows[0].block_ts) / 1000, metrics_history: rows } }), { status: 200 })));
    const result = await readRevertPositionHistory(position, { includePool: false });
    if (mode === "missing") expect(result.rangeActivity?.days[0].income).toBeUndefined();
    else {
      expect(result.rangeActivity?.days[0].income).toMatchObject({ feesUsd: 2, rewardsUsd: mode === "none" ? 0 : 1, averagePrincipalUsd: 1000, sampledSeconds: 7200 });
      expect(result.rangeActivity?.days[0].income?.annualizedPercent).toBeCloseTo(mode === "none" ? 73 : 109.5);
    }
  });
});
