import { encodeAbiParameters, encodeEventTopics, encodeFunctionResult, parseAbi } from "viem";
import { tickToPrice } from "../domain/smart-alerts.js";
import { confirmPortfolioExit } from "../services/portfolio-exit-confirmation.js";
import { syntheticPortfolio } from "./evaluation-cases.js";

const poolAbi = parseAbi(["function slot0() view returns (uint160 sqrtPriceX96,int24 tick)", "function token0() view returns (address)", "function token1() view returns (address)"]);
const swapAbi = parseAbi(["event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)"]);

export async function replayScenario() {
  const position = syntheticPortfolio("outside");
  position.token0.decimals = 18; position.token1.decimals = 18;
  position.lowerPrice = tickToPrice(100, 18, 18); position.upperPrice = tickToPrice(200, 18, 18); position.currentPrice = tickToPrice(50, 18, 18);
  const headTime = Math.floor(Date.now() / 1000);
  const hex = (value: number) => `0x${value.toString(16)}`;
  const hash = `0x${"a".repeat(64)}` as const;
  const topics = encodeEventTopics({ abi: swapAbi, eventName: "Swap", args: { sender: position.token0.address, recipient: position.token1.address } });
  const logs = [150, 50].map((tick, index) => ({
    address: position.pool, topics, data: encodeAbiParameters([{ type: "int256" }, { type: "int256" }, { type: "uint160" }, { type: "uint128" }, { type: "int24" }], [0n, 0n, 2n ** 96n, 1n, tick]),
    blockNumber: hex(80 + index), blockHash: hash, transactionHash: hash, transactionIndex: "0x0", logIndex: hex(index), removed: false,
  }));
  const slot = encodeFunctionResult({ abi: poolAbi, functionName: "slot0", result: [2n ** 96n, 50] });
  const token0 = encodeFunctionResult({ abi: poolAbi, functionName: "token0", result: position.token0.address });
  const token1 = encodeFunctionResult({ abi: poolAbi, functionName: "token1", result: position.token1.address });
  const previousFetch = globalThis.fetch;
  const previousRpc = process.env.BASE_HISTORY_RPC_URL;
  let reentry = false;
  type RpcRequest = { id: number; method: string; params: [string | { data: string }, ...unknown[]] };
  globalThis.fetch = async (_input, init) => {
    if (typeof init?.body !== "string") throw new Error("合成 RPC 请求格式无效");
    const request = JSON.parse(init.body) as RpcRequest | RpcRequest[];
    const reply = (item: RpcRequest) => {
      let result: unknown;
      if (item.method === "eth_chainId") result = "0x2105";
      else if (item.method === "eth_getBlockByNumber") {
        const block = item.params[0] === "latest" ? 100 : parseInt(String(item.params[0]), 16);
        result = { number: hex(block), timestamp: hex(headTime - (100 - block) * 10), hash, transactions: [] };
      } else if (item.method === "eth_call") {
        const data = (item.params[0] as { data: string }).data;
        if (data.startsWith("0x3850c7bd")) result = slot;
        else if (data.startsWith("0x0dfe1681")) result = token0;
        else if (data.startsWith("0xd21220a7")) result = token1;
        else throw new Error("合成 RPC 不支持该合约调用");
      } else if (item.method === "eth_getLogs") result = reentry ? logs : [];
      else throw new Error("合成 RPC 不支持该请求");
      return { jsonrpc: "2.0", id: item.id, result };
    };
    return new Response(JSON.stringify(Array.isArray(request) ? request.map(reply) : reply(request)), { headers: { "Content-Type": "application/json" } });
  };
  process.env.BASE_HISTORY_RPC_URL = "http://127.0.0.1:1";
  try {
    const since = new Date((headTime - 360) * 1000).toISOString();
    const continuous = await confirmPortfolioExit(position, since);
    reentry = true;
    const returned = await confirmPortfolioExit(position, since);
    return { ok: true, eventOk: true, guardrailOk: continuous && !returned, evidence: `合成 Swap 回放：持续区间外${continuous ? "通过" : "未通过"}；中途回到区间${returned ? "未拦截" : "已拦截"}。` };
  } finally {
    globalThis.fetch = previousFetch;
    if (previousRpc === undefined) delete process.env.BASE_HISTORY_RPC_URL;
    else process.env.BASE_HISTORY_RPC_URL = previousRpc;
  }
}
