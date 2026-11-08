import { createPublicClient, http, parseAbi, toEventSelector, toHex, padHex, type Hex } from "viem";
import type { PortfolioPosition } from "../../shared/portfolio.js";
import type { LpRangeActivity } from "../../shared/range-activity.js";
import { applyRangeActivityReplay } from "../domain/range-activity.js";
import { tickToPrice } from "../domain/smart-alerts.js";
import { positionManagerAbi } from "./pancake-v3.js";

const poolEvents = parseAbi([
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
  "event Initialize(uint160 sqrtPriceX96,int24 tick)",
]);
const poolAbi = parseAbi(["function slot0() view returns (uint160 sqrtPriceX96,int24 tick)", "function factory() view returns (address)"]);
const v3FactoryAbi = parseAbi(["function getPool(address,address,uint24) view returns (address)"]);
const clFactoryAbi = parseAbi(["function getPool(address,address,int24) view returns (address)"]);
const rpcDefaults: Record<number, [string, string]> = {
  1: ["ETHEREUM", "https://ethereum-rpc.publicnode.com"],
  10: ["OPTIMISM", "https://optimism-rpc.publicnode.com"],
  56: ["BSC", "https://bsc-rpc.publicnode.com"],
  4663: ["ROBINHOOD", "https://rpc.mainnet.chain.robinhood.com"],
  8453: ["BASE", "https://base-rpc.publicnode.com"],
  42161: ["ARBITRUM", "https://arbitrum-one-rpc.publicnode.com"],
};

export interface RangeHistoryAnchor { at: string; blockNumber: bigint }
export interface RangeHistoryMint extends RangeHistoryAnchor { transactionHash: Hex }
type RecoveredSpan = { from: number; to: number; state: "in-range" | "out-of-range" | "inactive" };
type ReplayEvent = { at: number; block: bigint; index: number; kind: "tick" | "liquidity"; tick?: number; liquidity?: bigint };

export async function backfillRangeActivity(position: PortfolioPosition, activity: LpRangeActivity, anchors: RangeHistoryAnchor[], mint?: RangeHistoryMint): Promise<LpRangeActivity> {
  const gaps: { from: number; to: number }[] = [];
  for (const day of activity.days) {
    const start = Date.parse(`${day.date}T00:00:00+08:00`) / 1000;
    for (const segment of day.segments) {
      if (segment.state !== "unknown") continue;
      const previous = gaps.at(-1);
      if (previous?.to === start + segment.fromSecond) previous.to = start + segment.toSecond;
      else gaps.push({ from: start + segment.fromSecond, to: start + segment.toSecond });
    }
  }
  if (!gaps.length) return activity;
  const recovered: RecoveredSpan[] = [];
  let eventCount = 0, completedRanges = 0;
  let throughBlock: string | undefined, throughAt: string | undefined;
  const warnings = [...activity.warnings];
  try {
    const config = rpcDefaults[position.chainId];
    if (!config || !mint || !activity.createdAt) throw new Error("Revert 未提供可核验的建仓交易，缺口等待补录。");
    const deadline = Date.now() + 90_000;
    const signal = AbortSignal.timeout(90_000);
    const rpcUrl = process.env[`${config[0]}_HISTORY_RPC_URL`] || process.env[`${config[0]}_RPC_URL`] || config[1];
    const client = createPublicClient({ transport: http(rpcUrl, { timeout: 8_000, retryCount: 0, fetchOptions: { signal } }) });
    const [chainId, head, receipt] = await Promise.all([
      client.getChainId(), client.getBlock({ blockTag: "latest" }), client.getTransactionReceipt({ hash: mint.transactionHash }),
    ]);
    if (chainId !== position.chainId || head.number === null || head.number < mint.blockNumber || !head.hash || receipt.status !== "success" || receipt.blockNumber !== mint.blockNumber) throw new Error("链上仓位身份校验未完成，缺口等待重试。");
    const tokenId = BigInt(position.tokenId!);
    const managers = [...new Set(receipt.logs.filter(log => log.topics.length === 4 && log.topics[0] === toEventSelector("Transfer(address,address,uint256)") && log.topics[1] === padHex("0x0", { size: 32 }) && log.topics[3] === padHex(toHex(tokenId), { size: 32 })).map(log => log.address))];
    if (managers.length !== 1) throw new Error("建仓事件无法唯一识别 NFT 合约，缺口等待核验。");
    const manager = managers[0];
    const nftAt = (blockNumber: bigint) => client.readContract({ address: manager, abi: positionManagerAbi, functionName: "positions", args: [tokenId], blockNumber });
    const [nft, factory] = await Promise.all([
      nftAt(head.number), client.readContract({ address: manager, abi: poolAbi, functionName: "factory", blockNumber: head.number }),
    ]);
    const expectedPool = await client.readContract({ address: factory, abi: position.sourceId === "base-aerodrome" ? clFactoryAbi : v3FactoryAbi, functionName: "getPool", args: [nft[2], nft[3], nft[4]], blockNumber: head.number });
    const lower = tickToPrice(nft[5], position.token0.decimals, position.token1.decimals);
    const upper = tickToPrice(nft[6], position.token0.decimals, position.token1.decimals);
    if (expectedPool.toLowerCase() !== position.pool.toLowerCase() || nft[2].toLowerCase() !== position.token0.address.toLowerCase() || nft[3].toLowerCase() !== position.token1.address.toLowerCase() || !position.lowerPrice || !position.upperPrice || Math.abs(lower / position.lowerPrice - 1) > 0.000001 || Math.abs(upper / position.upperPrice - 1) > 0.000001) throw new Error("链上池子或 NFT 区间与 Revert 不一致，缺口等待核验。");

    const blocks = new Map<bigint, Promise<{ timestamp: bigint; hash: Hex | null }>>();
    const block = (number: bigint) => {
      if (Date.now() >= deadline) throw new Error("链上回放已到本次读取上限，剩余缺口等待重试。");
      let task = blocks.get(number);
      if (!task) { task = client.getBlock({ blockNumber: number }); blocks.set(number, task); }
      return task;
    };
    const mintBlock = await block(mint.blockNumber);
    if (mintBlock.hash !== receipt.blockHash || Number(mintBlock.timestamp) !== Date.parse(activity.createdAt) / 1000) throw new Error("建仓时间与链上区块不一致，缺口等待核验。");
    const checkpoints = new Map([...anchors, mint].map(anchor => [Math.floor(Date.parse(anchor.at) / 1000), anchor.blockNumber]));
    async function blockAt(time: number): Promise<bigint> {
      const known = checkpoints.get(time);
      if (known !== undefined) {
        if (Number((await block(known)).timestamp) !== time) throw new Error("历史快照区块时间不匹配");
        return known;
      }
      if (time >= Number(head.timestamp)) return head.number!;
      let low = mint!.blockNumber, high = head.number!;
      let lowTime = Number(mintBlock.timestamp), highTime = Number(head.timestamp), attempts = 0;
      if (time <= lowTime) return low;
      while (high - low > 1n) {
        const estimate = attempts++ < 8 ? low + BigInt(time - lowTime) * (high - low) / BigInt(highTime - lowTime) : (low + high) / 2n;
        const middle = estimate <= low ? low + 1n : estimate >= high ? high - 1n : estimate;
        const timestamp = Number((await block(middle)).timestamp);
        if (timestamp < lowTime || timestamp > highTime) throw new Error("区块时间顺序无效");
        if (timestamp < time) { low = middle; lowTime = timestamp; }
        else { high = middle; highTime = timestamp; }
      }
      return high;
    }
    let chunks = 0;
    async function events(from: bigint, to: bigint): Promise<ReplayEvent[]> {
      const result: ReplayEvent[] = [];
      let step = 50_000n;
      for (let first = from; first <= to;) {
        if (++chunks > 96 || Date.now() >= deadline) throw new Error("链上回放已到本次读取上限，剩余缺口等待重试。");
        const last = first + step - 1n < to ? first + step - 1n : to;
        const requests = [
          client.getLogs({ address: position.pool, events: poolEvents, fromBlock: first, toBlock: last, strict: true }),
          client.request({ method: "eth_getLogs", params: [{ address: manager, topics: [null, padHex(toHex(tokenId), { size: 32 })], fromBlock: toHex(first), toBlock: toHex(last) }] }),
        ] as const;
        const [swaps, nftLogs] = await Promise.all(requests).catch(async error => { await Promise.allSettled(requests); throw error; });
        if (swaps.length >= 5_000 || nftLogs.length >= 5_000) {
          if (step <= 100n) throw new Error("事件密度超过本次回放上限，缺口等待更细粒度回填。");
          step /= 2n;
          continue;
        }
        for (const log of swaps) {
          if (log.removed || log.blockNumber === null || log.logIndex === null || !log.blockHash || log.blockNumber < first || log.blockNumber > last) throw new Error("链上事件未通过完整性校验");
          const timestamp = (log as unknown as { blockTimestamp?: bigint | string }).blockTimestamp;
          const at = Number(timestamp === undefined ? (await block(log.blockNumber)).timestamp : BigInt(timestamp));
          if (!Number.isSafeInteger(at) || at < Number(mintBlock.timestamp) || at > Number(head.timestamp) || !Number.isInteger(log.args.tick) || Math.abs(log.args.tick!) > 887272) throw new Error("链上事件字段无效");
          result.push({ at, block: log.blockNumber, index: log.logIndex, kind: "tick", tick: log.args.tick });
        }
        const nftBlocks = new Map<bigint, Hex>();
        for (const log of nftLogs) {
          if (log.removed || !log.blockNumber || !log.blockHash) throw new Error("NFT 事件未通过完整性校验");
          const number = BigInt(log.blockNumber);
          if (number < first || number > last || nftBlocks.has(number) && nftBlocks.get(number) !== log.blockHash) throw new Error("NFT 事件区块不一致");
          nftBlocks.set(number, log.blockHash);
        }
        // Read the NFT's end-of-block balance to cover CL deployments with different event parameter layouts.
        for (const [number, hash] of nftBlocks) {
          const [header, state] = await Promise.all([block(number), nftAt(number)]);
          if (header.hash !== hash) throw new Error("NFT 事件区块已变化");
          result.push({ at: Number(header.timestamp), block: number, index: Number.MAX_SAFE_INTEGER, kind: "liquidity", liquidity: state[7] });
        }
        if (result.length > 30_000) throw new Error("事件数量超过本次回放上限，剩余缺口等待重试。");
        first = last + 1n;
      }
      return result.sort((a, b) => a.block < b.block ? -1 : a.block > b.block ? 1 : a.index - b.index);
    }
    // Complete each gap atomically, so a failed or truncated stream never turns into inferred uptime.
    for (const gap of [...gaps].sort((a, b) => (b.to - b.from) - (a.to - a.from))) {
      try {
        const end = Math.min(gap.to, Number(head.timestamp));
        if (end <= gap.from) continue;
        const [first, last] = await Promise.all([blockAt(gap.from), blockAt(end)]);
        const before = first > 0n ? first - 1n : 0n;
        const stateRequests = [
          client.readContract({ address: position.pool, abi: poolAbi, functionName: "slot0", blockNumber: before }).catch(error => { if (first <= mint!.blockNumber) return undefined; throw error; }),
          first <= mint.blockNumber ? Promise.resolve(undefined) : nftAt(before),
          client.readContract({ address: position.pool, abi: poolAbi, functionName: "slot0", blockNumber: last }),
          nftAt(last), block(last),
        ] as const;
        const [initialPool, initialNft, finalPool, finalNft, endHeader] = await Promise.all(stateRequests).catch(async error => { await Promise.allSettled(stateRequests); throw error; });
        const changes = await events(first, last);
        let tick = initialPool && initialPool[0] > 0n ? initialPool[1] : undefined;
        let liquidity = initialNft?.[7] ?? 0n;
        let cursor = gap.from;
        const spans: RecoveredSpan[] = [];
        function append(to: number) {
          const state = liquidity === 0n ? "inactive" : tick === undefined ? undefined : tick >= nft[5] && tick < nft[6] ? "in-range" : "out-of-range";
          if (state && to > cursor) {
            const previous = spans.at(-1);
            if (previous?.state === state && previous.to === cursor) previous.to = to;
            else spans.push({ from: cursor, to, state });
          }
          cursor = to;
        }
        for (const change of changes) {
          const time = Math.max(gap.from, Math.min(end, change.at));
          if (time < cursor) throw new Error("链上事件时间顺序无效");
          append(time);
          if (change.kind === "tick") tick = change.tick;
          else liquidity = change.liquidity!;
          if (liquidity < 0n || liquidity >= 2n ** 128n) throw new Error("NFT 流动性事件不完整");
        }
        append(end);
        if (tick !== finalPool[1] || liquidity !== finalNft[7] || (await client.getBlock({ blockNumber: last })).hash !== endHeader.hash) throw new Error("回放终点与链上状态不一致");
        recovered.push(...spans);
        eventCount += changes.length;
        completedRanges++;
        if (!throughBlock || last > BigInt(throughBlock)) { throughBlock = String(last); throughAt = new Date(end * 1000).toISOString(); }
      } catch {
        warnings.push("部分时段的链上日志或历史状态未完成校验，缺口等待重试。");
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    warnings.push(/^(Revert 未提供|链上仓位身份|建仓事件|链上池子|建仓时间)/.test(message) ? message : "链上历史读取暂不可用，缺口等待重试。");
  }
  const result = applyRangeActivityReplay(activity, recovered.sort((a, b) => a.from - b.from));
  const filledSeconds = result.days.reduce((sum, day) => sum + (day.eventSeconds ?? 0), 0);
  return {
    ...result, warnings: [...new Set(warnings)],
    replay: {
      status: filledSeconds === 0 ? "unavailable" : result.days.some(day => day.seconds.unknown > 0) ? "partial" : "complete",
      filledSeconds, eventCount, completedRanges, attemptedRanges: gaps.length, throughBlock, throughAt,
    },
  };
}
