import { createPublicClient, fallback, formatUnits, http, parseAbi, zeroAddress, type Address, type PublicClient } from 'viem';
import type { LiveLpPosition, LpSourceId } from '../domain/types.js';
import { amountsForLiquidityAtSqrtPrice, priceFromSqrtPriceX96, priceFromTick, uncollectedFeeAmount } from '../domain/lp-math.js';

const positionAbi = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function positions(uint256 tokenId) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128,uint128 tokensOwed0,uint128 tokensOwed1)',
]);
const factoryAbi = parseAbi(['function getPool(address tokenA,address tokenB,uint24 fee) view returns (address pool)']);
const poolAbi = parseAbi([
  'function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint32 feeProtocol,bool unlocked)',
  'function tickSpacing() view returns (int24)',
  'function feeGrowthGlobal0X128() view returns (uint256)',
  'function feeGrowthGlobal1X128() view returns (uint256)',
  'function ticks(int24 tick) view returns (uint128 liquidityGross,int128 liquidityNet,uint256 feeGrowthOutside0X128,uint256 feeGrowthOutside1X128,int56 tickCumulativeOutside,uint160 secondsPerLiquidityOutsideX128,uint32 secondsOutside,bool initialized)',
]);
const tokenAbi = parseAbi(['function symbol() view returns (string)', 'function decimals() view returns (uint8)']);

export interface V3SourceConfig {
  sourceId: LpSourceId;
  chainId: number;
  networkName: string;
  protocol: string;
  rpcUrl: string;
  fallbackRpcUrls?: string[];
  explorer: string;
  positionManager: Address;
  factory: Address;
}

export class PositionNotFoundError extends Error {}

export function makeClient(config: V3SourceConfig): PublicClient {
  const hasFallback = Boolean(config.fallbackRpcUrls?.length);
  const transports = [config.rpcUrl, ...(config.fallbackRpcUrls || [])].map((url, index) => http(url, {
    batch: true,
    retryCount: hasFallback ? (index === 0 ? 0 : 1) : 3,
    retryDelay: 250,
    timeout: hasFallback && index === 0 ? 3_500 : 6_000,
  }));
  return createPublicClient({
    chain: { id: config.chainId, name: config.networkName, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } },
    batch: { multicall: true },
    transport: transports.length === 1 ? transports[0] : fallback(transports, { rank: true }),
  });
}

export function createV3Reader(config: V3SourceConfig, providedClient?: PublicClient) {
  const client = providedClient || makeClient(config);
  return async (tokenId: string): Promise<LiveLpPosition> => {
    const id = BigInt(tokenId);
    const targetBlockNumber = await client.getBlockNumber({ cacheTime: 0 });
    let owner: Address;
    let position: readonly [bigint, Address, Address, Address, number, number, number, bigint, bigint, bigint, bigint, bigint];
    try {
      [owner, position] = await Promise.all([
        client.readContract({ address: config.positionManager, abi: positionAbi, functionName: 'ownerOf', args: [id], blockNumber: targetBlockNumber }),
        client.readContract({ address: config.positionManager, abi: positionAbi, functionName: 'positions', args: [id], blockNumber: targetBlockNumber }),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : '';
      if (message.includes('revert') || message.includes('nonexistent') || message.includes('invalid token')) throw new PositionNotFoundError('该来源未找到此 NFT');
      throw error;
    }
    const [, , token0Address, token1Address, fee, tickLower, tickUpper, liquidity, feeGrowthInside0LastX128, feeGrowthInside1LastX128, tokensOwed0, tokensOwed1] = position;
    const poolAddress = await client.readContract({ address: config.factory, abi: factoryAbi, functionName: 'getPool', args: [token0Address, token1Address, fee], blockNumber: targetBlockNumber });
    if (poolAddress === zeroAddress) throw new Error('仓位池不存在');
    const [slot0, tickSpacing, symbol0, symbol1, decimals0, decimals1, targetBlock, feeGrowthGlobal0X128, feeGrowthGlobal1X128, lowerTick, upperTick] = await Promise.all([
      client.readContract({ address: poolAddress, abi: poolAbi, functionName: 'slot0', blockNumber: targetBlockNumber }),
      client.readContract({ address: poolAddress, abi: poolAbi, functionName: 'tickSpacing', blockNumber: targetBlockNumber }),
      client.readContract({ address: token0Address, abi: tokenAbi, functionName: 'symbol', blockNumber: targetBlockNumber }),
      client.readContract({ address: token1Address, abi: tokenAbi, functionName: 'symbol', blockNumber: targetBlockNumber }),
      client.readContract({ address: token0Address, abi: tokenAbi, functionName: 'decimals', blockNumber: targetBlockNumber }),
      client.readContract({ address: token1Address, abi: tokenAbi, functionName: 'decimals', blockNumber: targetBlockNumber }),
      client.getBlock({ blockNumber: targetBlockNumber }),
      client.readContract({ address: poolAddress, abi: poolAbi, functionName: 'feeGrowthGlobal0X128', blockNumber: targetBlockNumber }),
      client.readContract({ address: poolAddress, abi: poolAbi, functionName: 'feeGrowthGlobal1X128', blockNumber: targetBlockNumber }),
      client.readContract({ address: poolAddress, abi: poolAbi, functionName: 'ticks', args: [tickLower], blockNumber: targetBlockNumber }),
      client.readContract({ address: poolAddress, abi: poolAbi, functionName: 'ticks', args: [tickUpper], blockNumber: targetBlockNumber }),
    ]);
    const headBlockNumber = await client.getBlockNumber({ cacheTime: 0 });
    const currentTick = slot0[1];
    const currentPrice = priceFromSqrtPriceX96(slot0[0], decimals0, decimals1);
    const rangeLower = priceFromTick(tickLower, decimals0, decimals1);
    const rangeUpper = priceFromTick(tickUpper, decimals0, decimals1);
    const amounts = amountsForLiquidityAtSqrtPrice(liquidity, tickLower, tickUpper, slot0[0], decimals0, decimals1);
    const feeAmount0Raw = uncollectedFeeAmount({ liquidity, currentTick, tickLower, tickUpper, feeGrowthGlobalX128: feeGrowthGlobal0X128, feeGrowthOutsideLowerX128: lowerTick[2], feeGrowthOutsideUpperX128: upperTick[2], feeGrowthInsideLastX128: feeGrowthInside0LastX128, tokensOwed: tokensOwed0 });
    const feeAmount1Raw = uncollectedFeeAmount({ liquidity, currentTick, tickLower, tickUpper, feeGrowthGlobalX128: feeGrowthGlobal1X128, feeGrowthOutsideLowerX128: lowerTick[3], feeGrowthOutsideUpperX128: upperTick[3], feeGrowthInsideLastX128: feeGrowthInside1LastX128, tokensOwed: tokensOwed1 });
    const feeAmount0 = Number(formatUnits(feeAmount0Raw, decimals0));
    const feeAmount1 = Number(formatUnits(feeAmount1Raw, decimals1));
    const principalValueQuote = amounts.amount0 * currentPrice + amounts.amount1;
    const feeValueQuote = feeAmount0 * currentPrice + feeAmount1;
    const observedAt = new Date().toISOString();
    const blockTimestamp = new Date(Number(targetBlock.timestamp) * 1000).toISOString();
    const blockLag = Math.max(0, Number(headBlockNumber - targetBlockNumber));
    const blockAgeMs = Date.parse(observedAt) - Date.parse(blockTimestamp);
    const oldTargetBlock = blockAgeMs > 60_000;
    const captureStale = oldTargetBlock;
    const captureError = oldTargetBlock ? 'RPC 返回的目标区块时间过旧' : undefined;
    return {
      source: { type: 'onchain-v3', sourceId: config.sourceId, chainId: config.chainId, networkName: config.networkName, protocol: config.protocol, tokenId, positionManager: config.positionManager, poolAddress, explorerUrl: `${config.explorer}/token/${config.positionManager}?a=${tokenId}` },
      owner,
      token0: { address: token0Address, symbol: symbol0, decimals: decimals0 },
      token1: { address: token1Address, symbol: symbol1, decimals: decimals1 },
      feeTier: fee,
      tickSpacing,
      tickLower,
      tickUpper,
      currentTick,
      liquidity: liquidity.toString(),
      rangeLower,
      rangeUpper,
      currentPrice,
      snapshot: { blockNumber: targetBlockNumber.toString(), headBlockNumber: headBlockNumber.toString(), blockLag, blockTimestamp, observedAt, updatedAt: observedAt, currentPrice, amount0: amounts.amount0, amount1: amounts.amount1, principalValueQuote, feeAmount0, feeAmount1, feeValueQuote, totalValueQuote: principalValueQuote + feeValueQuote, stale: captureStale, error: captureError },
    };
  };
}
