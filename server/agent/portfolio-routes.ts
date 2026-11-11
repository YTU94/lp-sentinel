import { Router } from "express";
import { modelConfig, type ActiveModel } from "./model-config.js";
import { modelStatus } from "./model-service.js";
import { readUniswapPoolUniverse } from "../services/uniswap-pool-universe.js";
import { portfolioSources } from "../../shared/portfolio.js";
import { portfolioSource, readPortfolioRangeActivity, readWalletPortfolioPage, refreshPortfolioPosition, walletAddress } from "../services/wallet-portfolio.js";
import { analyzePortfolioPosition, portfolioAiStatus } from "./portfolio-analysis.js";

export function portfolioRoutes() {
  const router = Router();
  const pending = new Map<string, ReturnType<typeof analyze>>();
  router.get("/sources", (_request, response) => response.json(portfolioSources));
  router.get("/ai-status", async (request, response) => {
    try { response.json(await portfolioAiStatus(request.get("x-vercel-oidc-token"))); }
    catch { response.status(503).json({ error: "模型配置无法读取，请检查服务端配置文件" }); }
  });
  router.get("/range-activity", async (request, response) => {
    try {
      if (request.query.refresh !== undefined && request.query.refresh !== "1") return response.status(400).json({ error: "历史刷新参数无效" });
      const activity = await readPortfolioRangeActivity(request.query.address, request.query.sourceId, request.query.positionKey, request.query.refresh === "1");
      const maxAge = Math.max(0, Math.floor((Date.parse(activity.expiresAt) - Date.now()) / 1000));
      response.set("Cache-Control", `private, max-age=${maxAge}`).json(activity);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/^(请输入|不支持|仓位标识)/.test(message)) return response.status(400).json({ error: message });
      if (message === "Revert 仓位归属或来源已变化") return response.status(409).json({ error: "仓位信息已变化，请重新查询地址后查看历史" });
      if (message.startsWith("历史查询繁忙")) return response.status(429).json({ error: message });
      response.status(502).json({ error: "LP 有效区间历史暂不可用，请稍后重试" });
    }
  });
  router.get("/pool-universe", async (_request, response) => {
    try {
      const universe = await readUniswapPoolUniverse();
      response.set("Cache-Control", `public, s-maxage=${universe.status === "ready" ? 3600 : 300}, stale-while-revalidate=60`).json(universe);
    } catch { response.status(502).json({ error: "Uniswap Top 50 数据暂不可用，请稍后重新读取" }); }
  });
  router.get("/wallet/:address", async (request, response) => {
    try {
      walletAddress(request.params.address);
      portfolioSource(request.query.sourceId);
    } catch (error) { return response.status(400).json({ error: (error as Error).message }); }
    try {
      response.json(await readWalletPortfolioPage(request.params.address, request.query.sourceId, request.query.cursor));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.startsWith("分页")) return response.status(400).json({ error: message });
      response.status(502).json({ error: message.startsWith("Revert") ? message : "Revert 查仓未完成，请稍后重试此来源。" });
    }
  });
  async function analyze(address: string, sourceId: string, key: string, active: ActiveModel, gatewayToken?: string) {
    const status = await modelStatus(gatewayToken, active);
    if (!status.available) throw new Error(status.label);
    return analyzePortfolioPosition(await refreshPortfolioPosition(address, sourceId, key), gatewayToken, active);
  }
  router.post("/analyze", async (request, response) => {
    let address: string, sourceId: string, key: string;
    try {
      if (!request.body || typeof request.body !== "object" || Object.keys(request.body).sort().join(",") !== "address,positionKey,sourceId") throw new Error("请提供地址、来源和仓位标识");
      address = walletAddress(request.body.address);
      sourceId = portfolioSource(request.body.sourceId).id;
      key = request.body.positionKey;
      if (typeof key !== "string" || key.length > 240) throw new Error("仓位标识无效");
    } catch (error) { return response.status(400).json({ error: (error as Error).message }); }
    let active: ActiveModel;
    try { active = await modelConfig.active(); }
    catch { return response.status(503).json({ error: "模型配置无法读取，请检查服务端配置文件" }); }
    const id = `${address.toLowerCase()}:${key}:${modelConfig.revision}`;
    if (!pending.has(id) && pending.size >= 2) return response.status(429).json({ error: "已有分析正在进行，请稍后重试" });
    try {
      let task = pending.get(id);
      if (!task) { task = analyze(address, sourceId, key, active, request.get("x-vercel-oidc-token")); pending.set(id, task); }
      response.json(await task);
    } catch (error) {
      const message = error instanceof Error ? error.message : "分析失败，请重新查询后重试";
      const safe = /^(请|AI|Codex|仓位|链上快照|模型|Revert)/.test(message);
      response.status(502).json({ error: safe ? message : "仓位数据刷新或 AI 分析失败，请稍后重试" });
    } finally { pending.delete(id); }
  });
  return router;
}
