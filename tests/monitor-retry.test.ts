import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPosition } from "../server/domain/position.js";
import { PositionMonitor } from "../server/monitor.js";
import { JsonStore } from "../server/store.js";

describe("PositionMonitor alert delivery", () => {
  let directory: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("keeps an alert armed when direct-message delivery fails, then retries next check", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "lp-sentinel-monitor-"));
    const store = new JsonStore(path.join(directory, "data.json"));
    await store.load();
    const position = createPosition({
      name: "ETH",
      symbol: "ETHUSDT",
      baseAsset: "ETH",
      quoteAsset: "USDT",
      lowerPrice: 2_000,
      upperPrice: 3_000,
      entryPrice: 2_500,
      capitalQuote: 10_000,
      feeTier: 0.003,
      alertLower: 2_100,
      alertUpper: 2_900,
    });
    await store.update((data) => { data.positions.push(position); });

    const notifier = vi.fn()
      .mockRejectedValueOnce(new Error("DWS unavailable"))
      .mockResolvedValueOnce({ chatSent: true, dingSent: false });
    const monitor = new PositionMonitor(store, {
      priceProvider: async () => 2_950,
      identityProvider: async () => ({ authenticated: true, userId: "309595" }),
      notifier,
    });

    await monitor.checkAll();
    expect(store.snapshot.positions[0].alertState.armed).toBe(true);
    expect(store.snapshot.positions[0].lastError).toContain("DWS unavailable");

    await monitor.checkAll();
    expect(notifier).toHaveBeenCalledTimes(2);
    expect(store.snapshot.positions[0].alertState).toEqual({ armed: false, zone: "upper" });
    expect(store.snapshot.positions[0].lastAlertAt).toBeTruthy();
  });
});
