import { createPublicClient, http, type Address } from "viem";
import type { LiveLpPosition } from "../domain/live-lp.js";
import { readUniswapV3Position, type UniswapV3Deployment, type UniswapV3ContractReader } from "./robinhood-v3.js";

// Official deployments: https://developers.uniswap.org/docs/contracts/v3/reference/deployments/
export const additionalUniswapNetworks = [
  { sourceId: "ethereum-uniswap-v3", networkName: "Ethereum", chainId: 1, rpc: "https://ethereum-rpc.publicnode.com", env: "ETHEREUM_RPC_URL", explorer: "https://etherscan.io" },
  { sourceId: "arbitrum-uniswap-v3", networkName: "Arbitrum", chainId: 42161, rpc: "https://arbitrum-one-rpc.publicnode.com", env: "ARBITRUM_RPC_URL", explorer: "https://arbiscan.io" },
  { sourceId: "optimism-uniswap-v3", networkName: "Optimism", chainId: 10, rpc: "https://optimism-rpc.publicnode.com", env: "OPTIMISM_RPC_URL", explorer: "https://optimistic.etherscan.io" },
] as const;

export const UNISWAP_POSITION_MANAGER = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88" as Address;
export const UNISWAP_FACTORY = "0x1F98431c8aD98523631AE4a59f267346ea31F984" as Address;

export const additionalUniswapAdapters = additionalUniswapNetworks.map(network => {
  const client = createPublicClient({ transport: http(process.env[network.env] || network.rpc, { batch: true, timeout: 10_000, retryCount: 1 }) });
  const deployment: UniswapV3Deployment = {
    ...network, positionManager: UNISWAP_POSITION_MANAGER, factory: UNISWAP_FACTORY, nativeSymbol: "ETH",
    explorerUrl: id => `${network.explorer}/nft/${UNISWAP_POSITION_MANAGER}/${id}`,
    lifecycleUnavailableReason: "地址查询暂未回放完整历史现金流；当前显示链上快照。",
  };
  return {
    sourceId: network.sourceId, networkName: network.networkName, protocol: "Uniswap v3" as const,
    read: (id: bigint): Promise<LiveLpPosition> => readUniswapV3Position(id, deployment, client as unknown as UniswapV3ContractReader, null),
  };
});
