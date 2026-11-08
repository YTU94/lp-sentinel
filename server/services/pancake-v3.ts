import { createPublicClient, fallback, formatUnits, getAddress, http, parseAbiItem, type Address, type PublicClient } from "viem";
import { bsc } from "viem/chains";
import { normalizeIndexedTokenIds } from "../domain/wallet-position.js";
import type { LiveLpPosition } from "../domain/live-lp.js";
import { suggestAlertThresholds } from "../domain/smart-alerts.js";
import { readPositionLifecycleCached, readV3PoolPriceAtOrBefore, type PositionLifecycleReader } from "./position-lifecycle.js";

export const PANCAKE_V3_POSITION_MANAGER = "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364" as Address;
const PANCAKE_V3_FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865" as Address;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export const positionManagerAbi = [
  { type: "function", name: "ownerOf", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ type: "address" }] },
  { type: "function", name: "positions", stateMutability: "view", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [
    { name: "nonce", type: "uint96" }, { name: "operator", type: "address" }, { name: "token0", type: "address" }, { name: "token1", type: "address" },
    { name: "fee", type: "uint24" }, { name: "tickLower", type: "int24" }, { name: "tickUpper", type: "int24" }, { name: "liquidity", type: "uint128" },
    { name: "feeGrowthInside0LastX128", type: "uint256" }, { name: "feeGrowthInside1LastX128", type: "uint256" }, { name: "tokensOwed0", type: "uint128" }, { name: "tokensOwed1", type: "uint128" },
  ] },
] as const;

const erc20Abi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;
const factoryAbi = [{ type: "function", name: "getPool", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }], outputs: [{ type: "address" }] }] as const;
const poolAbi = [
  { type: "function", name: "slot0", stateMutability: "view", inputs: [], outputs: [{ name: "sqrtPriceX96", type: "uint160" }, { name: "tick", type: "int24" }, { name: "observationIndex", type: "uint16" }, { name: "observationCardinality", type: "uint16" }, { name: "observationCardinalityNext", type: "uint16" }, { name: "feeProtocol", type: "uint32" }, { name: "unlocked", type: "bool" }] },
  { type: "function", name: "feeGrowthGlobal0X128", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "feeGrowthGlobal1X128", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "ticks", stateMutability: "view", inputs: [{ type: "int24" }], outputs: [
    { name: "liquidityGross", type: "uint128" }, { name: "liquidityNet", type: "int128" },
    { name: "feeGrowthOutside0X128", type: "uint256" }, { name: "feeGrowthOutside1X128", type: "uint256" },
    { name: "tickCumulativeOutside", type: "int56" }, { name: "secondsPerLiquidityOutsideX128", type: "uint160" },
    { name: "secondsOutside", type: "uint32" }, { name: "initialized", type: "bool" },
  ] },
] as const;
const swapEvent = parseAbiItem("event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint128 protocolFeesToken0, uint128 protocolFeesToken1)");

const bscRpcUrls = [process.env.BSC_RPC_URL, "https://bsc-rpc.publicnode.com", "https://bsc-dataseed.binance.org"].filter((url): url is string => Boolean(url));
const client = createPublicClient({
  chain: bsc,
  transport: fallback(bscRpcUrls.map((url) => http(url, { retryCount: 1, timeout: 10_000 }))),
});
const bscHistoryRpcUrl = process.env.BSC_HISTORY_RPC_URL ?? process.env.BSC_RPC_URL;
const historyClient = bscHistoryRpcUrl
  ? createPublicClient({ chain: bsc, transport: http(bscHistoryRpcUrl, { retryCount: 1, timeout: 15_000 }) })
  : undefined;

export interface PancakeContractReader {
  readContract(args: any): Promise<any>;
  getBlockNumber(): Promise<bigint>;
  getBlock(args: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
  getLogs?(args: any): Promise<any[]>;
  getTransactionReceipt?(args: any): Promise<any>;
}

async function discoverTokenIds(address: Address): Promise<{ tokenIds: bigint[]; discovery: "bscscan" | "manual-required" }> {
  const key = process.env.BSCSCAN_API_KEY;
  if (!key) return { tokenIds: [], discovery: "manual-required" };
  const url = new URL("https://api.etherscan.io/v2/api");
  Object.entries({ chainid: "56", module: "account", action: "tokennfttx", contractaddress: PANCAKE_V3_POSITION_MANAGER, address, page: "1", offset: "10000", sort: "asc", apikey: key }).forEach(([name, value]) => url.searchParams.set(name, value));
  const response = await fetch(url);
  const body = await response.json() as { status: string; result: unknown };
  if (!response.ok || (body.status !== "1" && !Array.isArray(body.result))) throw new Error("BscScan 暂时无法枚举 LP NFT");
  return { tokenIds: normalizeIndexedTokenIds(body.result as Array<{ tokenID: string; to: string }>, address), discovery: "bscscan" };
}

function tickToPrice(tick: number, decimals0: number, decimals1: number) {
  return Math.pow(1.0001, tick) * Math.pow(10, decimals0 - decimals1);
}

const Q128 = 2n ** 128n;
const Q256 = 2n ** 256n;

function subtractUint256(value: bigint, subtrahend: bigint) {
  return (value - subtrahend + Q256) % Q256;
}

function feeGrowthInside(globalGrowth: bigint, lowerOutside: bigint, upperOutside: bigint, currentTick: number, tickLower: number, tickUpper: number) {
  const below = currentTick >= tickLower ? lowerOutside : subtractUint256(globalGrowth, lowerOutside);
  const above = currentTick < tickUpper ? upperOutside : subtractUint256(globalGrowth, upperOutside);
  return subtractUint256(subtractUint256(globalGrowth, below), above);
}

function collectableFees(liquidity: bigint, currentGrowth: bigint, lastGrowth: bigint, tokensOwed: bigint) {
  return tokensOwed + liquidity * subtractUint256(currentGrowth, lastGrowth) / Q128;
}

function feeTickSpacing(fee: number) {
  const known: Record<number, number> = { 100: 1, 500: 10, 2_500: 50, 10_000: 200 };
  const spacing = known[fee];
  if (!spacing) throw new Error(`不支持的 PancakeSwap V3 手续费档位：${fee}`);
  return spacing;
}

function positionAmounts(liquidity: bigint, sqrtPriceX96: bigint, tickLower: number, tickUpper: number, decimals0: number, decimals1: number) {
  const liquidityNumber = Number(liquidity);
  const sqrtPrice = Number(sqrtPriceX96) / 2 ** 96;
  const sqrtLower = Math.pow(1.0001, tickLower / 2);
  const sqrtUpper = Math.pow(1.0001, tickUpper / 2);
  const boundedSqrt = Math.min(sqrtUpper, Math.max(sqrtLower, sqrtPrice));
  return {
    amount0: liquidityNumber * (sqrtUpper - boundedSqrt) / (boundedSqrt * sqrtUpper) / 10 ** decimals0,
    amount1: liquidityNumber * (boundedSqrt - sqrtLower) / 10 ** decimals1,
  };
}

export async function readPancakeV3Position(
  tokenId: bigint,
  reader: PancakeContractReader = client as unknown as PancakeContractReader,
): Promise<LiveLpPosition> {
  if (tokenId <= 0n) throw new Error("NFT ID 必须是正整数");
  const [owner, position, blockNumber] = await Promise.all([
    reader.readContract({ address: PANCAKE_V3_POSITION_MANAGER, abi: positionManagerAbi, functionName: "ownerOf", args: [tokenId] }) as Promise<Address>,
    reader.readContract({ address: PANCAKE_V3_POSITION_MANAGER, abi: positionManagerAbi, functionName: "positions", args: [tokenId] }) as Promise<readonly [bigint, Address, Address, Address, number, number, number, bigint, bigint, bigint, bigint, bigint]>,
    reader.getBlockNumber(),
  ]);
  const [, , token0, token1, fee, tickLower, tickUpper, liquidity, feeGrowthInside0LastX128, feeGrowthInside1LastX128, tokensOwed0, tokensOwed1] = position;
  const [symbol0, symbol1, decimals0, decimals1, pool, block] = await Promise.all([
    reader.readContract({ address: token0, abi: erc20Abi, functionName: "symbol" }) as Promise<string>,
    reader.readContract({ address: token1, abi: erc20Abi, functionName: "symbol" }) as Promise<string>,
    reader.readContract({ address: token0, abi: erc20Abi, functionName: "decimals" }) as Promise<number>,
    reader.readContract({ address: token1, abi: erc20Abi, functionName: "decimals" }) as Promise<number>,
    reader.readContract({ address: PANCAKE_V3_FACTORY, abi: factoryAbi, functionName: "getPool", args: [token0, token1, fee] }) as Promise<Address>,
    reader.getBlock({ blockNumber }),
  ]);
  if (pool.toLowerCase() === ZERO) throw new Error("该 NFT 对应的 PancakeSwap V3 池不存在");
  const [slot0, feeGrowthGlobal0X128, feeGrowthGlobal1X128, lowerTick, upperTick] = await Promise.all([
    reader.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }) as Promise<readonly [bigint, number, number, number, number, number, boolean]>,
    reader.readContract({ address: pool, abi: poolAbi, functionName: "feeGrowthGlobal0X128" }) as Promise<bigint>,
    reader.readContract({ address: pool, abi: poolAbi, functionName: "feeGrowthGlobal1X128" }) as Promise<bigint>,
    reader.readContract({ address: pool, abi: poolAbi, functionName: "ticks", args: [tickLower] }) as Promise<readonly [bigint, bigint, bigint, bigint, bigint, bigint, number, boolean]>,
    reader.readContract({ address: pool, abi: poolAbi, functionName: "ticks", args: [tickUpper] }) as Promise<readonly [bigint, bigint, bigint, bigint, bigint, bigint, number, boolean]>,
  ]);
  const [sqrtPriceX96, currentTick] = slot0;
  const owed0 = collectableFees(liquidity, feeGrowthInside(feeGrowthGlobal0X128, lowerTick[2], upperTick[2], currentTick, tickLower, tickUpper), feeGrowthInside0LastX128, tokensOwed0);
  const owed1 = collectableFees(liquidity, feeGrowthInside(feeGrowthGlobal1X128, lowerTick[3], upperTick[3], currentTick, tickLower, tickUpper), feeGrowthInside1LastX128, tokensOwed1);
  const currentPrice = (Number(sqrtPriceX96) / 2 ** 96) ** 2 * 10 ** (decimals0 - decimals1);
  const lowerPrice = tickToPrice(tickLower, decimals0, decimals1);
  const upperPrice = tickToPrice(tickUpper, decimals0, decimals1);
  const tickSpacing = feeTickSpacing(fee);
  const { amount0, amount1 } = positionAmounts(liquidity, sqrtPriceX96, tickLower, tickUpper, decimals0, decimals1);
  const isDefaultReader = reader === (client as unknown as PancakeContractReader);
  const lifecycleReader = isDefaultReader
    ? historyClient as unknown as PositionLifecycleReader | undefined
    : reader.getLogs ? reader as PancakeContractReader & PositionLifecycleReader : undefined;
  const lifecycle = lifecycleReader?.getLogs ? await readPositionLifecycleCached({
    reader: lifecycleReader,
    positionManager: PANCAKE_V3_POSITION_MANAGER,
    tokenId,
    toBlock: blockNumber,
    currentTimestamp: block.timestamp,
    currentCollectable0: owed0,
    currentCollectable1: owed1,
    decimals0,
    decimals1,
    currentPrice,
    quotePriceAtEvent: (historicBlock, logIndex) => readV3PoolPriceAtOrBefore({
      reader: lifecycleReader,
      pool,
      event: swapEvent,
      blockNumber: historicBlock,
      logIndex,
      decimals0,
      decimals1,
    }),
    nativeSymbol: "BNB",
  }) : undefined;
  const lifecycleUnavailableReason = lifecycle ? undefined : isDefaultReader
    ? "BNB Chain 的公共 RPC 不提供完整历史日志；配置 BSC_HISTORY_RPC_URL 后会自动回填。"
    : undefined;
  return {
    sourceId: "bsc-pancake-v3",
    networkName: "BNB Chain",
    tokenId: tokenId.toString(),
    chainId: 56,
    protocol: "PancakeSwap V3",
    positionManager: PANCAKE_V3_POSITION_MANAGER,
    owner,
    pool,
    token0,
    token1,
    symbol0,
    symbol1,
    decimals0,
    decimals1,
    fee,
    tickSpacing,
    tickLower,
    currentTick,
    tickUpper,
    liquidity: liquidity.toString(),
    tokensOwed0: owed0.toString(),
    tokensOwed1: owed1.toString(),
    formattedOwed0: formatUnits(owed0, decimals0),
    formattedOwed1: formatUnits(owed1, decimals1),
    amount0,
    amount1,
    positionValueQuote: amount0 * currentPrice + amount1,
    currentPrice,
    lowerPrice,
    upperPrice,
    status: currentTick < tickLower ? "below" : currentTick >= tickUpper ? "above" : "in-range",
    blockNumber: blockNumber.toString(),
    updatedAt: new Date(Number(block.timestamp) * 1_000).toISOString(),
    alertRecommendation: tickUpper - tickLower >= tickSpacing * 4
      ? suggestAlertThresholds({ tickLower, tickUpper, tickSpacing, decimals0, decimals1 }) : undefined,
    explorerUrl: `https://bscscan.com/token/${PANCAKE_V3_POSITION_MANAGER}?a=${tokenId}`,
    lifecycle,
    lifecycleUnavailableReason,
  };
}

async function readOne(owner: Address, tokenId: bigint) {
  const position = await readPancakeV3Position(tokenId);
  if (position.owner.toLowerCase() !== owner.toLowerCase()) return null;
  return position;
}

export async function getWalletPositions(rawAddress: string, requestedTokenIds: string[] = []) {
  const address = getAddress(rawAddress);
  const manualIds = requestedTokenIds.filter(Boolean).map((id) => BigInt(id));
  const discovered = manualIds.length ? { tokenIds: manualIds, discovery: "manual" as const } : await discoverTokenIds(address);
  const settled = await Promise.allSettled([...new Set(discovered.tokenIds)].map((id) => readOne(address, id)));
  const positions = settled.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
  return { address, chainId: 56, protocol: "PancakeSwap V3", positionManager: PANCAKE_V3_POSITION_MANAGER, discovery: discovered.discovery, positions, updatedAt: new Date().toISOString() };
}
