import type { LiveLpPosition, LpSourceId } from "../domain/live-lp.js";
import { readBaseV3Position } from "./base-v3.js";
import { readPancakeV3Position } from "./pancake-v3.js";
import { readRobinhoodV3Position } from "./robinhood-v3.js";
import { additionalUniswapAdapters } from "./uniswap-networks.js";

export interface LpNftAdapter {
  sourceId: LpSourceId;
  networkName: LiveLpPosition["networkName"];
  protocol: LiveLpPosition["protocol"];
  read(tokenId: bigint): Promise<LiveLpPosition>;
}

export interface LpNftProbe {
  sourceId: LpSourceId;
  networkName: LiveLpPosition["networkName"];
  protocol: LiveLpPosition["protocol"];
  status: "matched" | "not-found" | "unavailable";
  message?: string;
}

export const lpNftAdapters: LpNftAdapter[] = [
  { sourceId: "robinhood-uniswap-v3", networkName: "Robinhood Chain", protocol: "Uniswap v3", read: readRobinhoodV3Position },
  { sourceId: "bsc-pancake-v3", networkName: "BNB Chain", protocol: "PancakeSwap V3", read: readPancakeV3Position },
  { sourceId: "base-uniswap-v3", networkName: "Base", protocol: "Uniswap v3", read: readBaseV3Position },
  ...additionalUniswapAdapters,
];

function isNotFound(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("nonexistent token") || message.includes("invalid token id") || message.includes("not_minted");
}

function parseTokenId(rawTokenId: string) {
  if (!/^[1-9]\d*$/.test(rawTokenId.trim())) throw new Error("NFT ID 必须是正整数");
  return BigInt(rawTokenId.trim());
}

export async function detectLpNft(rawTokenId: string, adapters: LpNftAdapter[] = lpNftAdapters) {
  const tokenId = parseTokenId(rawTokenId);
  const results = await Promise.all(adapters.map(async (adapter) => {
    try {
      return { adapter, position: await adapter.read(tokenId) };
    } catch (error) {
      return { adapter, error };
    }
  }));
  const matches = results.flatMap((result) => result.position ? [result.position] : []);
  const probes: LpNftProbe[] = results.map(({ adapter, position, error }) => ({
    sourceId: adapter.sourceId,
    networkName: adapter.networkName,
    protocol: adapter.protocol,
    status: position ? "matched" : isNotFound(error) ? "not-found" : "unavailable",
    ...position ? {} : { message: isNotFound(error) ? "该平台未找到此 NFT" : "网络查询暂不可用，请稍后重试" },
  }));
  return { tokenId: tokenId.toString(), matches, probes };
}

export async function readLpNftBySource(tokenId: bigint, sourceId: LpSourceId, adapters: LpNftAdapter[] = lpNftAdapters) {
  const adapter = adapters.find((item) => item.sourceId === sourceId);
  if (!adapter) throw new Error("不支持的 LP NFT 来源");
  return adapter.read(tokenId);
}
