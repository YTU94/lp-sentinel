import { createPublicClient, fallback, http, type Address } from "viem";
import { base } from "viem/chains";
import type { LiveLpPosition } from "../domain/live-lp.js";
import type { PositionLifecycleReader } from "./position-lifecycle.js";
import {
  readUniswapV3Position,
  type UniswapV3ContractReader,
  type UniswapV3Deployment,
} from "./robinhood-v3.js";

export const BASE_UNISWAP_V3 = {
  chainId: 8453,
  rpcUrl: "https://mainnet.base.org",
  explorerUrl: "https://basescan.org",
  positionManager: "0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1" as Address,
  factory: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD" as Address,
} as const;

const rpcUrls = [
  process.env.BASE_RPC_URL,
  BASE_UNISWAP_V3.rpcUrl,
  "https://base-rpc.publicnode.com",
].filter((url): url is string => Boolean(url));

const client = createPublicClient({
  chain: base,
  transport: fallback(rpcUrls.map((url) => http(url, { retryCount: 1, timeout: 10_000 }))),
});

const historyRpcUrl = process.env.BASE_HISTORY_RPC_URL ?? process.env.BASE_RPC_URL;
const historyClient = historyRpcUrl
  ? createPublicClient({ chain: base, transport: http(historyRpcUrl, { retryCount: 1, timeout: 15_000 }) })
  : undefined;

const deployment: UniswapV3Deployment = {
  sourceId: "base-uniswap-v3",
  networkName: "Base",
  chainId: BASE_UNISWAP_V3.chainId,
  positionManager: BASE_UNISWAP_V3.positionManager,
  factory: BASE_UNISWAP_V3.factory,
  nativeSymbol: "ETH",
  explorerUrl: (tokenId) => `${BASE_UNISWAP_V3.explorerUrl}/token/${BASE_UNISWAP_V3.positionManager}?a=${tokenId}`,
  lifecycleUnavailableReason: "Base 公共 RPC 不保证完整历史日志；配置 BASE_HISTORY_RPC_URL 后会自动回填。",
};

export type BaseContractReader = UniswapV3ContractReader;

export async function readBaseV3Position(
  tokenId: bigint,
  reader: BaseContractReader = client as unknown as BaseContractReader,
): Promise<LiveLpPosition> {
  const isDefaultReader = reader === (client as unknown as BaseContractReader);
  const lifecycleReader = isDefaultReader
    ? historyClient as unknown as PositionLifecycleReader | undefined
    : undefined;
  return readUniswapV3Position(
    tokenId,
    deployment,
    reader,
    isDefaultReader ? lifecycleReader ?? null : undefined,
  );
}
