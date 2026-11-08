import { createPublicClient, defineChain, formatUnits, http, parseAbiItem, type Address, type PublicClient } from "viem";
import { suggestAlertThresholds, tickToPrice, type SmartAlertRecommendation } from "../domain/smart-alerts.js";
import type { LiveLpPosition, LpSourceId } from "../domain/live-lp.js";
import { positionManagerAbi } from "./pancake-v3.js";
import { readPositionLifecycleCached, readV3PoolPriceAtOrBefore, type PositionLifecycleReader } from "./position-lifecycle.js";

const ZERO = "0x0000000000000000000000000000000000000000" as Address;

export const ROBINHOOD_UNISWAP_V3 = {
  chainId: 4663,
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  explorerUrl: "https://robinhoodchain.blockscout.com",
  positionManager: "0x73991a25c818bf1f1128deaab1492d45638de0d3" as Address,
  factory: "0x1f7d7550b1b028f7571e69a784071f0205fd2efa" as Address,
} as const;

const robinhoodChain = defineChain({
  id: ROBINHOOD_UNISWAP_V3.chainId,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [ROBINHOOD_UNISWAP_V3.rpcUrl] } },
  blockExplorers: { default: { name: "Blockscout", url: ROBINHOOD_UNISWAP_V3.explorerUrl } },
});

export interface RobinhoodRpcClientOptions {
  rpcUrl?: string;
  fetchFn?: typeof fetch;
}

export function createRobinhoodRpcClient(options: RobinhoodRpcClientOptions = {}): PublicClient {
  return createPublicClient({
    chain: robinhoodChain,
    transport: http(
      options.rpcUrl || process.env.ROBINHOOD_RPC_URL || ROBINHOOD_UNISWAP_V3.rpcUrl,
      {
        batch: { batchSize: 100, wait: 10 },
        fetchFn: options.fetchFn,
        retryCount: 5,
        retryDelay: 500,
      },
    ),
  });
}

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
const swapEvent = parseAbiItem("event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)");

const Q128 = 2n ** 128n;
const Q256 = 2n ** 256n;

function subtractUint256(value: bigint, subtrahend: bigint) {
  return (value - subtrahend + Q256) % Q256;
}

function feeGrowthInside(
  globalGrowth: bigint,
  lowerOutside: bigint,
  upperOutside: bigint,
  currentTick: number,
  tickLower: number,
  tickUpper: number,
) {
  const below = currentTick >= tickLower ? lowerOutside : subtractUint256(globalGrowth, lowerOutside);
  const above = currentTick < tickUpper ? upperOutside : subtractUint256(globalGrowth, upperOutside);
  return subtractUint256(subtractUint256(globalGrowth, below), above);
}

function collectableFees(
  liquidity: bigint,
  feeGrowthInsideCurrent: bigint,
  feeGrowthInsideLast: bigint,
  tokensOwed: bigint,
) {
  const accrued = liquidity * subtractUint256(feeGrowthInsideCurrent, feeGrowthInsideLast) / Q128;
  return tokensOwed + accrued;
}

const client = createRobinhoodRpcClient();

export interface UniswapV3ContractReader {
  readContract(args: any): Promise<any>;
  getBlockNumber(): Promise<bigint>;
  getBlock(args: { blockNumber: bigint }): Promise<{ timestamp: bigint }>;
  getLogs?(args: any): Promise<any[]>;
  getTransactionReceipt?(args: any): Promise<any>;
}

export type RobinhoodContractReader = UniswapV3ContractReader;

export interface UniswapV3Deployment {
  sourceId: LpSourceId;
  networkName: LiveLpPosition["networkName"];
  chainId: LiveLpPosition["chainId"];
  positionManager: Address;
  factory: Address;
  nativeSymbol: string;
  explorerUrl(tokenId: bigint): string;
  lifecycleUnavailableReason: string;
}

export type { LiveLpPosition } from "../domain/live-lp.js";

function feeTickSpacing(fee: number) {
  const known: Record<number, number> = { 100: 1, 500: 10, 3_000: 60, 10_000: 200 };
  const spacing = known[fee];
  if (!spacing) throw new Error(`不支持的 Uniswap v3 手续费档位：${fee}`);
  return spacing;
}

function positionAmounts(liquidity: bigint, sqrtPriceX96: bigint, tickLower: number, tickUpper: number, decimals0: number, decimals1: number) {
  const liquidityNumber = Number(liquidity);
  const sqrtPrice = Number(sqrtPriceX96) / 2 ** 96;
  const sqrtLower = Math.pow(1.0001, tickLower / 2);
  const sqrtUpper = Math.pow(1.0001, tickUpper / 2);
  const boundedSqrt = Math.min(sqrtUpper, Math.max(sqrtLower, sqrtPrice));
  const amount0 = liquidityNumber * (sqrtUpper - boundedSqrt) / (boundedSqrt * sqrtUpper) / 10 ** decimals0;
  const amount1 = liquidityNumber * (boundedSqrt - sqrtLower) / 10 ** decimals1;
  return { amount0, amount1 };
}

export async function readUniswapV3Position(
  tokenId: bigint,
  deployment: UniswapV3Deployment,
  reader: UniswapV3ContractReader,
  lifecycleReaderOverride?: PositionLifecycleReader | null,
): Promise<LiveLpPosition> {
  if (tokenId <= 0n) throw new Error("NFT ID 必须是正整数");

  const [owner, position, blockNumber] = await Promise.all([
    reader.readContract({ address: deployment.positionManager, abi: positionManagerAbi, functionName: "ownerOf", args: [tokenId] }) as Promise<Address>,
    reader.readContract({ address: deployment.positionManager, abi: positionManagerAbi, functionName: "positions", args: [tokenId] }) as Promise<readonly [bigint, Address, Address, Address, number, number, number, bigint, bigint, bigint, bigint, bigint]>,
    reader.getBlockNumber(),
  ]);
  const [, , token0, token1, fee, tickLower, tickUpper, liquidity, feeGrowthInside0LastX128, feeGrowthInside1LastX128, tokensOwed0, tokensOwed1] = position;
  const [symbol0, symbol1, decimals0, decimals1, pool, block] = await Promise.all([
    reader.readContract({ address: token0, abi: erc20Abi, functionName: "symbol" }) as Promise<string>,
    reader.readContract({ address: token1, abi: erc20Abi, functionName: "symbol" }) as Promise<string>,
    reader.readContract({ address: token0, abi: erc20Abi, functionName: "decimals" }) as Promise<number>,
    reader.readContract({ address: token1, abi: erc20Abi, functionName: "decimals" }) as Promise<number>,
    reader.readContract({ address: deployment.factory, abi: factoryAbi, functionName: "getPool", args: [token0, token1, fee] }) as Promise<Address>,
    reader.getBlock({ blockNumber }),
  ]);
  if (pool.toLowerCase() === ZERO) throw new Error("该 NFT 对应的 Uniswap v3 池不存在");
  const [slot0, feeGrowthGlobal0X128, feeGrowthGlobal1X128, lowerTick, upperTick] = await Promise.all([
    reader.readContract({ address: pool, abi: poolAbi, functionName: "slot0" }) as Promise<readonly [bigint, number, number, number, number, number, boolean]>,
    reader.readContract({ address: pool, abi: poolAbi, functionName: "feeGrowthGlobal0X128" }) as Promise<bigint>,
    reader.readContract({ address: pool, abi: poolAbi, functionName: "feeGrowthGlobal1X128" }) as Promise<bigint>,
    reader.readContract({ address: pool, abi: poolAbi, functionName: "ticks", args: [tickLower] }) as Promise<readonly [bigint, bigint, bigint, bigint, bigint, bigint, number, boolean]>,
    reader.readContract({ address: pool, abi: poolAbi, functionName: "ticks", args: [tickUpper] }) as Promise<readonly [bigint, bigint, bigint, bigint, bigint, bigint, number, boolean]>,
  ]);
  const [sqrtPriceX96, currentTick] = slot0;
  const owed0 = collectableFees(
    liquidity,
    feeGrowthInside(feeGrowthGlobal0X128, lowerTick[2], upperTick[2], currentTick, tickLower, tickUpper),
    feeGrowthInside0LastX128,
    tokensOwed0,
  );
  const owed1 = collectableFees(
    liquidity,
    feeGrowthInside(feeGrowthGlobal1X128, lowerTick[3], upperTick[3], currentTick, tickLower, tickUpper),
    feeGrowthInside1LastX128,
    tokensOwed1,
  );
  const currentPrice = (Number(sqrtPriceX96) / 2 ** 96) ** 2 * 10 ** (decimals0 - decimals1);
  const lowerPrice = tickToPrice(tickLower, decimals0, decimals1);
  const upperPrice = tickToPrice(tickUpper, decimals0, decimals1);
  const tickSpacing = feeTickSpacing(fee);
  const { amount0, amount1 } = positionAmounts(liquidity, sqrtPriceX96, tickLower, tickUpper, decimals0, decimals1);
  const lifecycleReader = lifecycleReaderOverride === null
    ? undefined
    : lifecycleReaderOverride ?? (reader.getLogs ? reader as UniswapV3ContractReader & PositionLifecycleReader : undefined);
  const lifecycle = lifecycleReader?.getLogs ? await readPositionLifecycleCached({
    reader: lifecycleReader,
    positionManager: deployment.positionManager,
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
    nativeSymbol: deployment.nativeSymbol,
  }) : undefined;
  const lifecycleUnavailableReason = lifecycle || lifecycleReaderOverride !== null
    ? undefined
    : deployment.lifecycleUnavailableReason;

  return {
    sourceId: deployment.sourceId,
    networkName: deployment.networkName,
    tokenId: tokenId.toString(),
    chainId: deployment.chainId,
    protocol: "Uniswap v3",
    positionManager: deployment.positionManager,
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
    explorerUrl: deployment.explorerUrl(tokenId),
    lifecycle,
    lifecycleUnavailableReason,
  };
}

const robinhoodDeployment: UniswapV3Deployment = {
  sourceId: "robinhood-uniswap-v3",
  networkName: "Robinhood Chain",
  chainId: ROBINHOOD_UNISWAP_V3.chainId,
  positionManager: ROBINHOOD_UNISWAP_V3.positionManager,
  factory: ROBINHOOD_UNISWAP_V3.factory,
  nativeSymbol: "ETH",
  explorerUrl: (tokenId) => `${ROBINHOOD_UNISWAP_V3.explorerUrl}/token/${ROBINHOOD_UNISWAP_V3.positionManager}/instance/${tokenId}`,
  lifecycleUnavailableReason: "当前 RPC 无法完整回放 NFT 历史事件或池价；更换支持历史日志的 ROBINHOOD_RPC_URL 后会自动回填。",
};

export async function readRobinhoodV3Position(
  tokenId: bigint,
  reader: RobinhoodContractReader = client as unknown as RobinhoodContractReader,
): Promise<LiveLpPosition> {
  return readUniswapV3Position(tokenId, robinhoodDeployment, reader);
}
