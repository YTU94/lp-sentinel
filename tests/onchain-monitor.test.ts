import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPosition } from "../server/domain/position.js";
import { PositionMonitor } from "../server/monitor.js";
import { JsonStore } from "../server/store.js";

let temporaryDirectory: string | undefined;

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

describe("on-chain LP monitoring", () => {
  it("refreshes imported Robinhood positions from the NFT instead of Binance", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "lp-sentinel-onchain-"));
    temporaryDirectory = directory;
    const storePath = path.join(directory, "store.json");
    const store = new JsonStore(storePath);
    await store.load();
    const position = createPosition({
      name: "WETH / USDG · NFT #984513",
      symbol: "WETHUSDG",
      baseAsset: "WETH",
      quoteAsset: "USDG",
      lowerPrice: 2_258,
      upperPrice: 2_578,
      entryPrice: 2_401,
      capitalQuote: 1_000,
      feeTier: 0.0001,
      alertLower: 2_295,
      alertUpper: 2_535,
      source: {
        type: "robinhood-uniswap-v3",
        chainId: 4663,
        tokenId: "984513",
      },
    });
    await store.update((data) => data.positions.push(position));

    const priceProvider = vi.fn(async () => {
      throw new Error("Binance must not be used");
    });
    const lpPositionProvider = vi.fn(async () => ({
      currentPrice: 2_400,
      amount0: 2,
      amount1: 300,
      positionValueQuote: 5_100,
      formattedOwed0: "0.01",
      formattedOwed1: "5",
      blockNumber: "123456",
      updatedAt: "2026-09-04T02:30:00.000Z",
    }));
    const monitor = new PositionMonitor(store, {
      priceProvider,
      lpPositionProvider,
      identityProvider: vi.fn(async () => ({ authenticated: false })),
      notifier: vi.fn(),
    });

    await monitor.checkAll();

    expect(priceProvider).not.toHaveBeenCalled();
    expect(lpPositionProvider).toHaveBeenCalledWith(984_513n, "robinhood-uniswap-v3");
    expect(store.snapshot.positions[0].currentPrice).toBe(2_400);
    expect((store.snapshot.positions[0] as unknown as { chainSnapshot?: unknown }).chainSnapshot).toEqual({
      assets: [
        { symbol: "WETH", amount: 2, valueQuote: 4_800 },
        { symbol: "USDG", amount: 300, valueQuote: 300 },
      ],
      unclaimedFees: [
        { symbol: "WETH", amount: 0.01, valueQuote: 24 },
        { symbol: "USDG", amount: 5, valueQuote: 5 },
      ],
      principalValueQuote: 5_100,
      unclaimedFeesValueQuote: 29,
      totalValueQuote: 5_129,
      blockNumber: "123456",
      updatedAt: "2026-09-04T02:30:00.000Z",
    });
    expect(JSON.parse(await readFile(storePath, "utf8")).positions[0].lastError).toBeUndefined();
  });

  it("refreshes an imported BNB Chain PancakeSwap NFT through its live source", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "lp-sentinel-pancake-monitor-"));
    temporaryDirectory = directory;
    const store = new JsonStore(path.join(directory, "store.json"));
    await store.load();
    await store.update((data) => data.positions.push(createPosition({
      name: "WBNB / SPCXB · NFT #7314935",
      symbol: "WBNBSPCXB",
      baseAsset: "WBNB",
      quoteAsset: "SPCXB",
      lowerPrice: 0.9,
      upperPrice: 1.1,
      entryPrice: 1,
      capitalQuote: 100,
      feeTier: 0.0025,
      alertLower: 0.92,
      alertUpper: 1.08,
      source: { type: "bsc-pancake-v3", chainId: 56, tokenId: "7314935" },
    })));
    const priceProvider = vi.fn(async () => { throw new Error("Binance must not be used"); });
    const lpPositionProvider = vi.fn(async () => ({
      currentPrice: 1,
      amount0: 40,
      amount1: 60,
      positionValueQuote: 100,
      formattedOwed0: "0.1",
      formattedOwed1: "0.2",
      blockNumber: "50000001",
      updatedAt: "2026-09-04T04:00:00.000Z",
    }));
    const monitor = new PositionMonitor(store, {
      priceProvider,
      lpPositionProvider,
      identityProvider: vi.fn(async () => ({ authenticated: false })),
      notifier: vi.fn(),
    });

    await monitor.checkAll();

    expect(priceProvider).not.toHaveBeenCalled();
    expect(lpPositionProvider).toHaveBeenCalledWith(7_314_935n, "bsc-pancake-v3");
    expect(store.snapshot.positions[0].currentPrice).toBe(1);
  });

  it("annualizes fee growth observed across the latest one-hour on-chain window", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "lp-sentinel-apr-"));
    temporaryDirectory = directory;
    const store = new JsonStore(path.join(directory, "store.json"));
    await store.load();
    await store.update((data) => data.positions.push(createPosition({
      name: "WETH / USDG · NFT #984513",
      symbol: "WETHUSDG",
      baseAsset: "WETH",
      quoteAsset: "USDG",
      lowerPrice: 2_258,
      upperPrice: 2_578,
      entryPrice: 2_401,
      capitalQuote: 5_100,
      feeTier: 0.0001,
      alertLower: 2_295,
      alertUpper: 2_535,
      source: { type: "robinhood-uniswap-v3", chainId: 4663, tokenId: "984513" },
    })));

    const snapshots = [
      {
        currentPrice: 2_400,
        amount0: 2,
        amount1: 300,
        positionValueQuote: 5_100,
        formattedOwed0: "0",
        formattedOwed1: "0",
        blockNumber: "123456",
        updatedAt: "2026-09-04T02:00:00.000Z",
      },
      {
        currentPrice: 2_400,
        amount0: 2,
        amount1: 300,
        positionValueQuote: 5_100,
        formattedOwed0: "0.01",
        formattedOwed1: "5",
        blockNumber: "123999",
        updatedAt: "2026-09-04T03:00:00.000Z",
      },
    ];
    const lpPositionProvider = vi.fn(async () => snapshots.shift()!);
    const monitor = new PositionMonitor(store, {
      priceProvider: vi.fn(),
      lpPositionProvider,
      identityProvider: vi.fn(async () => ({ authenticated: false })),
      notifier: vi.fn(),
    });

    await monitor.checkAll();
    await monitor.checkAll();

    expect(store.snapshot.positions[0].chainSnapshot?.feeApr1h).toEqual({
      annualizedPercent: 4_981.176470588234,
      feesEarnedQuote: 29,
      windowSeconds: 3_600,
      sampleCount: 2,
      fullWindow: true,
    });
  });
});
