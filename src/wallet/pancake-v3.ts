import { createPublicClient, createWalletClient, custom, encodeFunctionData, http, maxUint128, type Address, type EIP1193Provider } from "viem";
import { bsc } from "viem/chains";
import { validateRemovalRequest } from "./removal";

export const POSITION_MANAGER = "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364" as Address;
const abi = [
  { type: "function", name: "decreaseLiquidity", stateMutability: "payable", inputs: [{ name: "params", type: "tuple", components: [{ name: "tokenId", type: "uint256" }, { name: "liquidity", type: "uint128" }, { name: "amount0Min", type: "uint256" }, { name: "amount1Min", type: "uint256" }, { name: "deadline", type: "uint256" }] }], outputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "collect", stateMutability: "payable", inputs: [{ name: "params", type: "tuple", components: [{ name: "tokenId", type: "uint256" }, { name: "recipient", type: "address" }, { name: "amount0Max", type: "uint128" }, { name: "amount1Max", type: "uint128" }] }], outputs: [{ type: "uint256" }, { type: "uint256" }] },
  { type: "function", name: "multicall", stateMutability: "payable", inputs: [{ name: "data", type: "bytes[]" }], outputs: [{ type: "bytes[]" }] },
] as const;

function provider(): EIP1193Provider {
  const walletWindow = window as Window & {
    BinanceChain?: EIP1193Provider;
    binancew3w?: { ethereum?: EIP1193Provider };
    ethereum?: EIP1193Provider;
  };
  const injected = walletWindow.binancew3w?.ethereum || walletWindow.BinanceChain || walletWindow.ethereum;
  if (!injected) throw new Error("未检测到浏览器钱包，请安装或打开 Binance Wallet 扩展");
  return injected;
}

export async function connectBscWallet(): Promise<Address> {
  const injected = provider();
  const accounts = await injected.request({ method: "eth_requestAccounts" }) as Address[];
  if (!accounts[0]) throw new Error("钱包未授权账户");
  const chainId = await injected.request({ method: "eth_chainId" }) as string;
  if (Number(chainId) !== 56) {
    try { await injected.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x38" }] }); }
    catch { throw new Error("请在钱包中切换到 BNB Smart Chain"); }
  }
  return accounts[0];
}

export async function removeLiquidity(input: { account: Address; owner: Address; tokenId: bigint; liquidity: bigint; percent: number; slippageBps: number }) {
  const checked = validateRemovalRequest(input);
  const publicClient = createPublicClient({ chain: bsc, transport: http() });
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  const previewParams = { tokenId: input.tokenId, liquidity: checked.liquidityToRemove, amount0Min: 0n, amount1Min: 0n, deadline };
  const preview = await publicClient.simulateContract({ account: input.account, address: POSITION_MANAGER, abi, functionName: "decreaseLiquidity", args: [previewParams] });
  const [amount0, amount1] = preview.result;
  const amount0Min = amount0 * BigInt(10_000 - checked.slippageBps) / 10_000n;
  const amount1Min = amount1 * BigInt(10_000 - checked.slippageBps) / 10_000n;
  const calls = [
    encodeFunctionData({ abi, functionName: "decreaseLiquidity", args: [{ ...previewParams, amount0Min, amount1Min }] }),
    encodeFunctionData({ abi, functionName: "collect", args: [{ tokenId: input.tokenId, recipient: input.account, amount0Max: maxUint128, amount1Max: maxUint128 }] }),
  ];
  await publicClient.simulateContract({ account: input.account, address: POSITION_MANAGER, abi, functionName: "multicall", args: [calls] });
  return { amount0, amount1, amount0Min, amount1Min, liquidityToRemove: checked.liquidityToRemove, execute: async () => {
    const wallet = createWalletClient({ account: input.account, chain: bsc, transport: custom(provider()) });
    return wallet.writeContract({ address: POSITION_MANAGER, abi, functionName: "multicall", args: [calls] });
  } };
}

export async function waitForRemoval(hash: Address) {
  const publicClient = createPublicClient({ chain: bsc, transport: http() });
  return publicClient.waitForTransactionReceipt({ hash });
}
