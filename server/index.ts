import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPosition, readPositionAlertUpdate, readPositionEnabledUpdate } from "./domain/position.js";
import { createStaticApp } from "./http/static-app.js";
import { PositionMonitor } from "./monitor.js";
import { getDwsIdentity } from "./services/dws-auth.js";
import { JsonStore } from "./store.js";
import { searchBinanceSymbols } from "./services/binance-symbol-search.js";
import { getWalletPositions } from "./services/pancake-v3.js";
import { positionInputFromLiveLp } from "./domain/live-lp-import.js";
import { readRobinhoodV3Position } from "./services/robinhood-v3.js";
import { detectLpNft, readLpNftBySource } from "./services/lp-nft-registry.js";
import type { LpSourceId } from "./domain/live-lp.js";
import { StrategyAgent } from "./agent/runtime.js";
import { agentRoutes } from "./agent/routes.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const store = new JsonStore(process.env.LP_SENTINEL_DATA_FILE || path.join(root, "data", "lp-sentinel.json"));
await store.load();

const agent = new StrategyAgent(store);
await agent.start();
const monitor = new PositionMonitor(store, undefined, () => agent.observe());
monitor.start();

const app = express();
app.use(express.json());
app.use("/api/agent", agentRoutes(agent));

app.get("/api/state", async (_request, response) => {
  const { agent: _agent, ...state } = store.snapshot;
  response.json({ ...state, dws: await getDwsIdentity(), serverTime: new Date().toISOString() });
});

app.get("/api/tokens/search", async (request, response) => {
  try {
    response.json(await searchBinanceSymbols(String(request.query.q || "")));
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : "代币搜索失败" });
  }
});

app.get("/api/wallet/:address/pancake-v3", async (request, response) => {
  try {
    const tokenIds = String(request.query.tokenIds || "").split(",").map((item) => item.trim()).filter(Boolean);
    response.json(await getWalletPositions(request.params.address, tokenIds));
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "钱包仓位读取失败" });
  }
});

app.get("/api/lp/robinhood-uniswap-v3/:tokenId", async (request, response) => {
  try {
    response.json(await readRobinhoodV3Position(BigInt(request.params.tokenId)));
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "Robinhood LP NFT 读取失败" });
  }
});

app.get("/api/lp-nft/:tokenId", async (request, response) => {
  try {
    response.json(await detectLpNft(request.params.tokenId));
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "LP NFT 查询失败" });
  }
});

app.post("/api/positions/from-lp-nft", async (request, response) => {
  try {
    const sourceId = String(request.body.sourceId || "robinhood-uniswap-v3") as LpSourceId;
    const livePosition = await readLpNftBySource(BigInt(request.body.tokenId), sourceId);
    const existing = store.snapshot.positions.find((item) =>
      item.source?.type === livePosition.sourceId && item.source.tokenId === livePosition.tokenId,
    );
    if (existing) return response.status(409).json({ error: `NFT #${livePosition.tokenId} 已在预警列表中` });
    const position = createPosition(positionInputFromLiveLp(livePosition));
    await store.update((data) => { data.positions.unshift(position); });
    void monitor.checkAll();
    response.status(201).json(position);
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "LP NFT 导入失败" });
  }
});

app.patch("/api/positions/:id/enabled", async (request, response) => {
  const current = store.snapshot.positions.find((item) => item.id === request.params.id);
  if (!current) return response.status(404).json({ error: "仓位不存在" });
  try {
    const enabled = readPositionEnabledUpdate(request.body);
    await store.update((data) => {
      const index = data.positions.findIndex((item) => item.id === current.id);
      data.positions[index] = { ...data.positions[index], enabled, updatedAt: new Date().toISOString() };
    });
    void monitor.checkAll();
    response.json(store.snapshot.positions.find((item) => item.id === current.id));
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "LP 不支持编辑" });
  }
});

app.patch("/api/positions/:id/alerts", async (request, response) => {
  const current = store.snapshot.positions.find((item) => item.id === request.params.id);
  if (!current) return response.status(404).json({ error: "仓位不存在" });
  try {
    const alerts = readPositionAlertUpdate(request.body, current);
    await store.update((data) => {
      const index = data.positions.findIndex((item) => item.id === current.id);
      data.positions[index] = {
        ...data.positions[index],
        ...alerts,
        alertState: { armed: true, zone: "safe" },
        updatedAt: new Date().toISOString(),
      };
    });
    void monitor.checkAll();
    response.json(store.snapshot.positions.find((item) => item.id === current.id));
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : "预警线调整失败" });
  }
});

app.delete("/api/positions/:id", async (request, response) => {
  const before = store.snapshot.positions.length;
  await store.update((data) => { data.positions = data.positions.filter((item) => item.id !== request.params.id); });
  response.status(before === store.snapshot.positions.length ? 404 : 204).end();
});

app.patch("/api/settings", async (request, response) => {
  const interval = Number(request.body.pollIntervalSeconds);
  if (!Number.isFinite(interval) || interval < 5 || interval > 300) {
    return response.status(400).json({ error: "轮询间隔必须在 5—300 秒之间" });
  }
  if ((request.body.dingEnabled || request.body.dingCallEnabled) && !String(request.body.dingRobotCode || "").trim()) {
    return response.status(400).json({ error: "开启 DING 前请填写机器人编码" });
  }
  await store.update((data) => {
    data.settings = {
      pollIntervalSeconds: interval,
      dingEnabled: Boolean(request.body.dingEnabled),
      dingCallEnabled: Boolean(request.body.dingCallEnabled),
      dingRobotCode: String(request.body.dingRobotCode || "").trim(),
    };
  });
  monitor.reschedule();
  response.json(store.snapshot.settings);
});

app.post("/api/refresh", async (_request, response) => {
  await monitor.checkAll();
  response.json({ ok: true });
});

if (process.env.NODE_ENV === "production") {
  app.use(createStaticApp(path.join(root, "dist")));
}

const port = Number(process.env.LP_SENTINEL_PORT || 4317);
app.listen(port, "127.0.0.1", () => {
  console.log(`LP Sentinel API: http://127.0.0.1:${port}`);
});

process.on("SIGTERM", () => { monitor.stop(); agent.stop(); });
