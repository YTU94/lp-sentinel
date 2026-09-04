import { createWalletClient, custom, defineChain, type EIP1193Provider, type WalletClient } from 'viem';

declare global { interface Window { ethereum?: EIP1193Provider } }

export const bsc = defineChain({
  id: 56,
  name: 'BNB Smart Chain',
  nativeCurrency: { decimals: 18, name: 'BNB', symbol: 'BNB' },
  rpcUrls: { default: { http: ['https://bsc-dataseed.binance.org'] } },
  blockExplorers: { default: { name: 'BscScan', url: 'https://bscscan.com' } },
});

export async function connectPancakeWallet(): Promise<{ address: `0x${string}`; client: WalletClient }> {
  if (!window.ethereum) throw new Error('未检测到 Binance Wallet 或兼容 EVM 钱包');
  try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x38' }] }); }
  catch { await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x38', chainName: bsc.name, nativeCurrency: bsc.nativeCurrency, rpcUrls: bsc.rpcUrls.default.http, blockExplorerUrls: [bsc.blockExplorers.default.url] }] }); }
  const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' }) as string[];
  if (!accounts[0]) throw new Error('钱包未返回地址');
  return { address: accounts[0] as `0x${string}`, client: createWalletClient({ account: accounts[0] as `0x${string}`, chain: bsc, transport: custom(window.ethereum) }) };
}
