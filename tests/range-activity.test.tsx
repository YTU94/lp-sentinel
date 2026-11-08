// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RangeActivity } from "../src/range-activity.js";
import type { PortfolioPosition } from "../shared/portfolio.js";
import type { LpRangeActivity } from "../shared/range-activity.js";

it("shows daily APR, a genuine zero and missing data separately, with selected-day income details", async () => {
  const data: LpRangeActivity = {
    version: 1, positionKey: "test", source: "revert", timezone: "Asia/Shanghai", method: "snapshot-step", maxGapSeconds: 10800,
    fetchedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300000).toISOString(), sampleCount: 4, downsampled: false, warnings: [],
    days: [1, 2, 3].map((day, index) => ({
      date: `2026-11-0${day}`, inRangePercent: 100, seconds: { "in-range": 86400, "out-of-range": 0, unknown: 0, inactive: 0, future: 0 },
      segments: [{ fromSecond: 0, toSecond: 86400, state: "in-range" }],
      income: index < 2 ? { annualizedPercent: index ? 0 : 36.5, feesUsd: index ? 0 : .6, rewardsUsd: index ? 0 : .4, averagePrincipalUsd: 1000, sampledSeconds: 86400 } : undefined,
    })),
  };
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(data), { status: 200 })));
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<RangeActivity address="0x1111111111111111111111111111111111111111" position={{ key: "test", sourceId: "base-uniswap-v3" } as PortfolioPosition} />); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(container.querySelector(".range-activity-axis")?.textContent).toContain("当日 APR");
    expect([...container.querySelectorAll(".range-activity-apr")].map(node => node.textContent)).toEqual(["≈36.50%", "≈0.00%", "—"]);
    const first = container.querySelector<HTMLButtonElement>(".range-activity-row")!;
    expect(first.getAttribute("aria-label")).toContain("36.50%");
    await act(async () => first.click());
    const details = container.querySelector(".range-activity-detail")?.textContent;
    expect(details).toContain("当日年化 APR");
    expect(details).toContain("≈36.50%");
    expect(details).toContain("手续费"); expect(details).toContain("奖励"); expect(details).toContain("1,000");
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
  }
});
