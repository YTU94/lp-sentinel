import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActionStateMachine, deriveActionStage } from "../src/action-state-machine.js";
import type { Position } from "../src/types.js";

function position(overrides: Partial<Position> = {}): Position {
  return {
    id: "position-1",
    name: "WETH / USDG · NFT #984513",
    symbol: "WETHUSDG",
    baseAsset: "WETH",
    quoteAsset: "USDG",
    lowerPrice: 2_258,
    upperPrice: 2_578,
    entryPrice: 2_401,
    capitalQuote: 33_000,
    feeTier: 0.0001,
    alertLower: 2_295,
    alertUpper: 2_535,
    enabled: true,
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    alertState: { armed: true, zone: "safe" },
    currentPrice: 2_400,
    simulation: { baseAmount: 1, quoteAmount: 1, valueQuote: 33_000, status: "in-range", progress: 0.5 },
    ...overrides,
  };
}

describe("ActionStateMachine", () => {
  it("keeps an in-range price between both warning lines in SAFE", () => {
    expect(deriveActionStage(position())).toBe("safe");
  });

  it("moves a price inside the LP range but beyond a warning line to WARNING", () => {
    expect(deriveActionStage(position({ currentPrice: 2_550 }))).toBe("warning");
  });

  it("marks a price beyond the LP boundary as EXECUTE", () => {
    expect(deriveActionStage(position({ currentPrice: 2_590 }))).toBe("execute");
  });

  it("renders every action stage and identifies the current one without relying on color", () => {
    const markup = renderToStaticMarkup(createElement(ActionStateMachine, { position: position({ currentPrice: 2_550 }) }));

    expect(markup.match(/data-stage=/g)).toHaveLength(4);
    expect(markup).toContain('data-stage="safe"');
    expect(markup).toContain('data-stage="warning"');
    expect(markup).toContain('data-stage="execute"');
    expect(markup).toContain('data-stage="cooldown"');
    expect(markup).toContain('data-stage="warning" aria-current="step"');
    expect(markup).toContain("选择并确认");
    expect(markup).toContain("当前阶段");
    expect(markup).toContain("策略预览，不会自动发起交易");
  });
});
