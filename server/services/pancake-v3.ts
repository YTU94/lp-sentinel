import { createV3Reader } from './v3-reader.js';

export const defaultBscRpcUrls = [
  'https://bsc-rpc.publicnode.com',
  'https://bsc-dataseed.binance.org',
] as const;

export const pancakeConfig = {
  sourceId: 'bsc-pancake-v3' as const,
  chainId: 56,
  networkName: 'BNB Chain',
  protocol: 'PancakeSwap V3',
  rpcUrl: process.env.BSC_RPC_URL || defaultBscRpcUrls[0],
  fallbackRpcUrls: process.env.BSC_RPC_URL ? [] : [defaultBscRpcUrls[1]],
  explorer: 'https://bscscan.com',
  positionManager: '0x46A15B0b27311cedF172AB29E4f4766fbE7F4364' as const,
  factory: '0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865' as const,
};

export const readPancakePosition = createV3Reader(pancakeConfig);

export async function readWalletPancakePositions(address: string) {
  const apiKey = process.env.BSCSCAN_API_KEY;
  if (!apiKey) return { positions: [], discovery: '需要配置 BSCSCAN_API_KEY 才能自动枚举；仍可按 NFT ID 查询。' };
  const url = new URL('https://api.bscscan.com/v2/api');
  url.search = new URLSearchParams({ chainid: '56', module: 'account', action: 'tokennfttx', contractaddress: pancakeConfig.positionManager, address, page: '1', offset: '100', sort: 'desc', apikey: apiKey }).toString();
  const response = await fetch(url);
  if (!response.ok) throw new Error('BscScan 暂时不可用');
  const payload = await response.json() as { result?: Array<{ tokenID: string }> };
  const ids = [...new Set((payload.result || []).map((item) => item.tokenID))];
  const results = await Promise.allSettled(ids.map(readPancakePosition));
  return { positions: results.filter((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof readPancakePosition>>> => item.status === 'fulfilled').map((item) => item.value).filter((item) => item.owner.toLowerCase() === address.toLowerCase()), discovery: 'bscscan' };
}
