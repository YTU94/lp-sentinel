import { formatUnits, parseAbiItem, type Address, type Hex } from "viem";
import type { LiveLpLifecycle } from "../domain/live-lp.js";

const increaseLiquidityEvent = parseAbiItem("event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)");
const decreaseLiquidityEvent = parseAbiItem("event DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)");
const collectEvent = parseAbiItem("event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1)");
const HISTORY_TTL_MS = 5 * 60 * 1_000;

interface LifecycleLog {
  blockNumber: bigint | null;
  logIndex: number | null;
  transactionHash: Hex | null;
  args: { amount0?: bigint; amount1?: bigint };
  kind: "increase" | "decrease" | "collect";
}

export interface PositionLifecycleReader {
  getLogs(args: any): Promise<any[]>;
  getBlock(args: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
  getTransactionReceipt?(args: { hash: Hex }): Promise<{ gasUsed: bigint; effectiveGasPrice?: bigint; gasPrice?: bigint }>;
}

interface PoolPriceLog {
  blockNumber: bigint | null;
  logIndex: number | null;
  args: { sqrtPriceX96?: bigint };
}

export async function readV3PoolPriceAtOrBefore(input: {
  reader: PositionLifecycleReader;
  pool: Address;
  event: any;
  blockNumber: bigint;
  logIndex: number;
  decimals0: number;
  decimals1: number;
}) {
  for (const lookback of [0n, 100n, 1_000n, 10_000n, 100_000n, 1_000_000n]) {
    const fromBlock = input.blockNumber > lookback ? input.blockNumber - lookback : 0n;
    const logs = await input.reader.getLogs({
      address: input.pool,
      event: input.event,
      fromBlock,
      toBlock: input.blockNumber,
    }) as PoolPriceLog[];
    const latest = logs
      .filter((log) => log.blockNumber !== null && log.args.sqrtPriceX96 !== undefined &&
        (log.blockNumber! < input.blockNumber || (log.logIndex ?? 0) <= input.logIndex))
      .sort((left, right) => Number(left.blockNumber! - right.blockNumber!) || (left.logIndex ?? 0) - (right.logIndex ?? 0))
      .at(-1);
    if (latest?.args.sqrtPriceX96 !== undefined) {
      return (Number(latest.args.sqrtPriceX96) / 2 ** 96) ** 2 * 10 ** (input.decimals0 - input.decimals1);
    }
  }
  throw new Error("无法从池 Swap 日志还原历史价格");
}

interface ReadPositionLifecycleInput {
  reader: PositionLifecycleReader;
  positionManager: Address;
  tokenId: bigint;
  toBlock: bigint;
  currentTimestamp: bigint;
  currentCollectable0: bigint;
  currentCollectable1: bigint;
  decimals0: number;
  decimals1: number;
  currentPrice: number;
  quotePriceAtEvent?: (blockNumber: bigint, logIndex: number) => Promise<number>;
  nativeSymbol: string;
}

const cache = new WeakMap<object, Map<string, { expiresAt: number; value: Promise<LiveLpLifecycle | undefined> }>>();

function minimum(left: bigint, right: bigint) {
  return left < right ? left : right;
}

function nonNegative(value: bigint) {
  return value > 0n ? value : 0n;
}

function asAmount(value: bigint, decimals: number) {
  return Number(formatUnits(value, decimals));
}

export async function readPositionLifecycle(input: ReadPositionLifecycleInput): Promise<LiveLpLifecycle | undefined> {
  const queries = [
    { event: increaseLiquidityEvent, kind: "increase" as const },
    { event: decreaseLiquidityEvent, kind: "decrease" as const },
    { event: collectEvent, kind: "collect" as const },
  ];
  const batches = await Promise.all(queries.map(async ({ event, kind }) => {
    const logs = await input.reader.getLogs({
      address: input.positionManager,
      event,
      args: { tokenId: input.tokenId },
      fromBlock: 0n,
      toBlock: input.toBlock,
    });
    return logs.map((log) => ({ ...log, kind })) as LifecycleLog[];
  }));
  const events = batches.flat().filter((event) => event.blockNumber !== null).sort((left, right) => {
    const blockOrder = Number(left.blockNumber! - right.blockNumber!);
    return blockOrder || (left.logIndex ?? 0) - (right.logIndex ?? 0);
  });
  const firstIncrease = events.find((event) => event.kind === "increase");
  if (!firstIncrease?.blockNumber) return undefined;

  let deposited0 = 0n;
  let deposited1 = 0n;
  let withdrawn0 = 0n;
  let withdrawn1 = 0n;
  let collected0 = 0n;
  let collected1 = 0n;
  let pendingRemoved0 = 0n;
  let pendingRemoved1 = 0n;
  let claimedFees0 = 0n;
  let claimedFees1 = 0n;
  let depositedValueQuote = 0;
  let withdrawnValueQuote = 0;
  let collectedValueQuote = 0;
  let claimedFeesValueQuote = 0;

  const eventKeys = [...new Set(events.map((event) => `${event.blockNumber}:${event.logIndex ?? 0}`))];
  const eventPrices = new Map<string, number>();
  if (input.quotePriceAtEvent) {
    const prices = await Promise.all(eventKeys.map(async (key) => {
      const [block, logIndex] = key.split(":");
      return [key, await input.quotePriceAtEvent!(BigInt(block), Number(logIndex))] as const;
    }));
    prices.forEach(([key, price]) => eventPrices.set(key, price));
  }

  for (const event of events) {
    const amount0 = event.args.amount0 ?? 0n;
    const amount1 = event.args.amount1 ?? 0n;
    const quotePrice = eventPrices.get(`${event.blockNumber}:${event.logIndex ?? 0}`) ?? input.currentPrice;
    const quoteValue = (raw0: bigint, raw1: bigint) => asAmount(raw0, input.decimals0) * quotePrice + asAmount(raw1, input.decimals1);
    if (event.kind === "increase") {
      deposited0 += amount0;
      deposited1 += amount1;
      depositedValueQuote += quoteValue(amount0, amount1);
    } else if (event.kind === "decrease") {
      withdrawn0 += amount0;
      withdrawn1 += amount1;
      pendingRemoved0 += amount0;
      pendingRemoved1 += amount1;
      withdrawnValueQuote += quoteValue(amount0, amount1);
    } else {
      collected0 += amount0;
      collected1 += amount1;
      collectedValueQuote += quoteValue(amount0, amount1);
      const principal0 = minimum(pendingRemoved0, amount0);
      const principal1 = minimum(pendingRemoved1, amount1);
      pendingRemoved0 -= principal0;
      pendingRemoved1 -= principal1;
      const fee0 = amount0 - principal0;
      const fee1 = amount1 - principal1;
      claimedFees0 += fee0;
      claimedFees1 += fee1;
      claimedFeesValueQuote += quoteValue(fee0, fee1);
    }
  }

  const unclaimedFees0 = nonNegative(input.currentCollectable0 - pendingRemoved0);
  const unclaimedFees1 = nonNegative(input.currentCollectable1 - pendingRemoved1);
  const firstBlock = await input.reader.getBlock({ blockNumber: firstIncrease.blockNumber });
  const createdAt = new Date(Number(firstBlock.timestamp) * 1_000).toISOString();
  const ageSeconds = Math.max(0, Number(input.currentTimestamp - firstBlock.timestamp));

  let gasSpentNative: number | undefined;
  if (input.reader.getTransactionReceipt) {
    const hashes = [...new Set(events.map((event) => event.transactionHash).filter((hash): hash is Hex => Boolean(hash)))];
    const receipts = await Promise.all(hashes.map((hash) => input.reader.getTransactionReceipt!({ hash })));
    const gasWei = receipts.reduce((total, receipt) => total + receipt.gasUsed * (receipt.effectiveGasPrice ?? receipt.gasPrice ?? 0n), 0n);
    gasSpentNative = Number(formatUnits(gasWei, 18));
  }

  return {
    createdAt,
    ageSeconds,
    eventCount: events.length,
    deposited0: asAmount(deposited0, input.decimals0),
    deposited1: asAmount(deposited1, input.decimals1),
    withdrawn0: asAmount(withdrawn0, input.decimals0),
    withdrawn1: asAmount(withdrawn1, input.decimals1),
    collected0: asAmount(collected0, input.decimals0),
    collected1: asAmount(collected1, input.decimals1),
    claimedFees0: asAmount(claimedFees0, input.decimals0),
    claimedFees1: asAmount(claimedFees1, input.decimals1),
    unclaimedFees0: asAmount(unclaimedFees0, input.decimals0),
    unclaimedFees1: asAmount(unclaimedFees1, input.decimals1),
    totalFees0: asAmount(claimedFees0 + unclaimedFees0, input.decimals0),
    totalFees1: asAmount(claimedFees1 + unclaimedFees1, input.decimals1),
    pendingRemoved0: asAmount(pendingRemoved0, input.decimals0),
    pendingRemoved1: asAmount(pendingRemoved1, input.decimals1),
    depositedValueQuote,
    withdrawnValueQuote,
    collectedValueQuote,
    claimedFeesValueQuote,
    gasSpentNative,
    nativeSymbol: input.nativeSymbol,
  };
}

export function readPositionLifecycleCached(input: ReadPositionLifecycleInput): Promise<LiveLpLifecycle | undefined> {
  const readerKey = input.reader as object;
  let readerCache = cache.get(readerKey);
  if (!readerCache) {
    readerCache = new Map();
    cache.set(readerKey, readerCache);
  }
  const key = `${input.positionManager.toLowerCase()}:${input.tokenId}`;
  const cached = readerCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = readPositionLifecycle(input).catch(() => undefined);
  readerCache.set(key, { expiresAt: Date.now() + HISTORY_TTL_MS, value });
  return value;
}
