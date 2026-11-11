import { createPublicClient, http, parseAbi, type Hex } from "viem";
import type { PortfolioPosition } from "../../shared/portfolio.js";
import { tickToPrice } from "../domain/smart-alerts.js";
import { rpcDefaults } from "./range-activity-replay.js";

const poolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96,int24 tick)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);
const swapEvents = parseAbi([
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint128 protocolFeesToken0,uint128 protocolFeesToken1)",
]);

export async function confirmPortfolioExit(position: PortfolioPosition, outsideSince: string) {
  const config = rpcDefaults[position.chainId];
  if (!config || !position.lowerPrice || !position.upperPrice) throw new Error("该仓位缺少链上区间核验信息");
  const tick = (price: number) => Math.round((Math.log(price) - (position.token0.decimals - position.token1.decimals) * Math.LN10) / Math.log(1.0001));
  const lower = tick(position.lowerPrice), upper = tick(position.upperPrice);
  if (!Number.isInteger(lower) || !Number.isInteger(upper) || lower < -887272 || upper > 887272 || lower >= upper
      || Math.abs(tickToPrice(lower, position.token0.decimals, position.token1.decimals) / position.lowerPrice - 1) > 0.000001
      || Math.abs(tickToPrice(upper, position.token0.decimals, position.token1.decimals) / position.upperPrice - 1) > 0.000001) {
    throw new Error("Revert 区间无法匹配链上 tick，等待核验");
  }
  const signal = AbortSignal.timeout(30_000);
  const rpcUrl = process.env[`${config[0]}_HISTORY_RPC_URL`] || process.env[`${config[0]}_RPC_URL`] || config[1];
  const client = createPublicClient({ transport: http(rpcUrl, { timeout: 8_000, retryCount: 0, fetchOptions: { signal } }) });
  const [chainId, head] = await Promise.all([client.getChainId(), client.getBlock({ blockTag: "latest" })]);
  const since = Math.ceil(Date.parse(outsideSince) / 1000);
  if (chainId !== position.chainId || head.number === null || !head.hash || !Number.isFinite(since)) throw new Error("链上来源或区块信息无效");
  if (Number(head.timestamp) < since + 300) throw new Error("链上区块时间尚未覆盖完整 5 分钟");
  const target = Number(head.timestamp) - 300;
  let low = head.number > 50_000n ? head.number - 50_000n : 0n;
  let high = head.number;
  let lowTime = Number((await client.getBlock({ blockNumber: low })).timestamp), highTime = Number(head.timestamp);
  if (lowTime >= target) throw new Error("链上区块范围不足，等待重试");
  for (let attempt = 0; high - low > 1n; attempt++) {
    if (attempt > 24) throw new Error("链上区块时间定位失败");
    const estimate = attempt < 6 && highTime > lowTime ? low + BigInt(target - lowTime) * (high - low) / BigInt(highTime - lowTime) : (low + high) / 2n;
    const middle = estimate <= low ? low + 1n : estimate >= high ? high - 1n : estimate;
    const time = Number((await client.getBlock({ blockNumber: middle })).timestamp);
    if (time < lowTime || time > highTime) throw new Error("链上区块时间顺序无效");
    if (time < target) { low = middle; lowTime = time; } else { high = middle; highTime = time; }
  }
  const before = high > 0n ? high - 1n : 0n;
  const [first, last, token0, token1] = await Promise.all([
    client.readContract({ address: position.pool, abi: poolAbi, functionName: "slot0", blockNumber: before }),
    client.readContract({ address: position.pool, abi: poolAbi, functionName: "slot0", blockNumber: head.number }),
    client.readContract({ address: position.pool, abi: poolAbi, functionName: "token0", blockNumber: head.number }),
    client.readContract({ address: position.pool, abi: poolAbi, functionName: "token1", blockNumber: head.number }),
  ]);
  if (token0.toLowerCase() !== position.token0.address.toLowerCase() || token1.toLowerCase() !== position.token1.address.toLowerCase()) throw new Error("链上池子代币与仓位不一致");
  const side = (value: number) => value < lower ? -1 : value >= upper ? 1 : 0;
  const initialSide = side(first[1]);
  if (!initialSide || side(last[1]) !== initialSide) return false;
  let lastTick = first[1];
  let from = high, step = 2_500n;
  const events = position.sourceId === "bsc-pancake-v3" ? [swapEvents[1]] : [swapEvents[0]];
  while (from <= head.number) {
    const to = from + step - 1n < head.number ? from + step - 1n : head.number;
    let logs;
    try { logs = await client.getLogs({ address: position.pool, events, fromBlock: from, toBlock: to, strict: true }); }
    catch (error) { if (step <= 1n) throw error; step /= 2n; continue; }
    if (logs.length >= 5_000) { if (step <= 1n) throw new Error("链上事件密度超过核验上限"); step /= 2n; continue; }
    logs.sort((a, b) => a.blockNumber! < b.blockNumber! ? -1 : a.blockNumber! > b.blockNumber! ? 1 : a.logIndex! - b.logIndex!);
    for (const log of logs) {
      if (log.removed || log.blockNumber === null || log.logIndex === null || !log.blockHash || log.blockNumber < from || log.blockNumber > to || !Number.isInteger(log.args.tick)) throw new Error("链上 Swap 事件不完整");
      lastTick = log.args.tick!;
      if (side(lastTick) !== initialSide) return false;
    }
    from = to + 1n;
  }
  if (lastTick !== last[1] || (await client.getBlock({ blockNumber: head.number })).hash !== head.hash as Hex) throw new Error("链上回放终点未通过核验");
  return true;
}
