// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PortfolioAdviceView } from "../src/portfolio-advice.js";
import type { PortfolioAdvice } from "../shared/portfolio.js";

it("显示两套方案并默认收起依据、风险和步骤", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const advice = { options: { conservative: { action: "hold", summary: "保留现仓", strategy: "观察价格", trigger: "核对报价" }, aggressive: { action: "recenter", summary: "准备重建", strategy: "评估新区间", trigger: "确认成本" } }, summary: "当前已出区间", reasons: ["价格低于下界"], risks: ["换币改变敞口"], nextSteps: ["核对报价"], snapshot: { updatedAt: "2026-11-11T00:00:00Z" }, createdAt: "2026-11-11T00:00:00Z" } as PortfolioAdvice;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<PortfolioAdviceView advice={advice} providerLabel="测试" />));
    expect(container.querySelectorAll(".portfolio-strategy-option")).toHaveLength(2);
    expect(container.textContent).toContain("保守方案"); expect(container.textContent).toContain("激进方案");
    expect(container.querySelector("details")?.open).toBe(false);
    await act(async () => container.querySelector("summary")!.click());
    expect(container.querySelector("details")?.open).toBe(true);
    expect(container.querySelector("details")?.textContent).toContain("换币改变敞口");
  } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); }
});
