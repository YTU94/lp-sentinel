import { createPublicClient, encodeFunctionData, http, parseAbi, type Address, type WalletClient } from 'viem';
import { bsc } from './pancake-v3';
import type { LiveLpPosition } from '../types';

const abi = parseAbi([
  'function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline) params) payable returns (uint256 amount0,uint256 amount1)',
  'function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max) params) payable returns (uint256 amount0,uint256 amount1)',
  'function multicall(bytes[] data) payable returns (bytes[] results)',
]);

export async function removeAllLiquidity(wallet: WalletClient, position: LiveLpPosition, recipient: Address) {
  if (position.source.sourceId !== 'bsc-pancake-v3') throw new Error('当前只支持 PancakeSwap V3 移除');
  if (position.owner.toLowerCase() !== recipient.toLowerCase()) throw new Error('该 NFT 不是当前钱包直接持有');
  const scale0 = 10 ** position.token0.decimals;
  const scale1 = 10 ** position.token1.decimals;
  const amount0Min = BigInt(Math.floor(position.snapshot.amount0 * scale0 * 0.995));
  const amount1Min = BigInt(Math.floor(position.snapshot.amount1 * scale1 * 0.995));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
  const decrease = encodeFunctionData({ abi, functionName: 'decreaseLiquidity', args: [{ tokenId: BigInt(position.source.tokenId), liquidity: BigInt(position.liquidity), amount0Min, amount1Min, deadline }] });
  const collect = encodeFunctionData({ abi, functionName: 'collect', args: [{ tokenId: BigInt(position.source.tokenId), recipient, amount0Max: 2n ** 128n - 1n, amount1Max: 2n ** 128n - 1n }] });
  const args = [[decrease, collect]] as const;
  const publicClient = createPublicClient({ chain: bsc, transport: http(import.meta.env.VITE_BSC_RPC_URL || bsc.rpcUrls.default.http[0]) });
  await publicClient.simulateContract({ account: recipient, address: position.source.positionManager, abi, functionName: 'multicall', args });
  return wallet.writeContract({ account: recipient, chain: bsc, address: position.source.positionManager, abi, functionName: 'multicall', args });
}
