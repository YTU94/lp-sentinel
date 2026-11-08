// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../src/App.js";
import { api } from "../src/api.js";
import type { AppState, Position } from "../src/types.js";

vi.mock("../src/portfolio-agent.js", () => ({ PortfolioAgent: ({ positions }: { positions: Position[] }) => <div data-testid="agent"><h1>LP 策略 Agent</h1><span>{positions.length} 条既有记录</span></div> }));

const state: AppState = {
  positions: [{ id: "existing", name: "既有仓位", symbol: "ETHUSDC", feeTier: .003, alertState: { armed: true, zone: "safe" } } as Position],
  settings: { pollIntervalSeconds: 5, dingEnabled: false, dingCallEnabled: false, dingRobotCode: "" },
  dws: { authenticated: false }, serverTime: "2026-11-08T15:00:00Z",
};
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(api, "state").mockResolvedValue(state);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const render = () => act(async () => { root.render(<App />); await new Promise(resolve => setTimeout(resolve, 0)); });

it("uses the Agent as the only main module, without the navigation rail or NFT query", async () => {
  await render();
  expect(container.querySelector(".position-rail")).toBeNull();
  expect(container.textContent).not.toContain("按 NFT 查询");
  expect(container.querySelector(".workspace > .portfolio-deck [data-testid='agent']")?.textContent).toContain("1 条既有记录");
  expect(container.querySelectorAll("main > section")).toHaveLength(1);
  expect(container.querySelector("[aria-label='连接钱包']")).toBeNull();
});

it("keeps refresh and settings usable while staying in the Agent", async () => {
  const refresh = vi.spyOn(api, "refresh").mockResolvedValue(undefined);
  await render();
  await act(async () => container.querySelector<HTMLButtonElement>("[aria-label='立即刷新行情']")!.click());
  expect(refresh).toHaveBeenCalledOnce();
  expect(api.state).toHaveBeenCalledTimes(2);
  await act(async () => container.querySelector<HTMLButtonElement>("[aria-label='报警设置']")!.click());
  expect(container.querySelector(".config-form")).not.toBeNull();
  expect(container.querySelector("[data-testid='agent']")).not.toBeNull();
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(container.querySelector(".config-panel")).toBeNull();
});
