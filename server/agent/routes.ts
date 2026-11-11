import { Router } from "express";
import type { StrategyAgent } from "./runtime.js";
import { portfolioRoutes } from "./portfolio-routes.js";
import type { PortfolioWatch } from "./portfolio-watch.js";
import { getDwsRecipient } from "../services/dws-auth.js";
import type { AgentEvaluation } from "./evaluation.js";
import { modelConfig } from "./model-config.js";
import { testModel } from "./model-service.js";
import type { SampleCollector } from "./samples.js";

export function agentRoutes(agent: StrategyAgent, portfolioWatch?: PortfolioWatch, evaluation?: AgentEvaluation, samples?: SampleCollector) {
  const router = Router();
  let testingModel = false;
  router.use((request, response, next) => {
    try {
      const host = new URL(`http://${request.get("host")}`).hostname;
      if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) return response.status(403).json({ error: "策略服务仅接受本机访问" });
    } catch { return response.status(403).json({ error: "请求主机无效" }); }
    if (request.method !== "GET") {
      const origin = request.get("origin");
      const expectedHost = request.get("host");
      if (origin) {
        try {
          if (new URL(origin).host !== expectedHost) return response.status(403).json({ error: "不接受跨站策略操作" });
        } catch { return response.status(403).json({ error: "请求来源无效" }); }
      }
      if (!request.is("application/json")) return response.status(415).json({ error: "请使用 JSON 请求" });
    }
    next();
  });
  router.get("/", (_request, response) => response.json(agent.view));
  if (samples) {
    router.get("/samples", (_request, response) => response.set("Cache-Control", "no-store").json(samples.view));
    router.put("/samples/wallet", async (request, response) => {
      try { response.set("Cache-Control", "no-store").json(await samples.setWallet(request.body?.address, request.body?.queriedAt)); }
      catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "采样钱包设置失败" }); }
    });
    router.post("/samples/refresh", (_request, response) => {
      void samples.refresh().catch(() => undefined);
      response.status(202).set("Cache-Control", "no-store").json(samples.view);
    });
  }
  router.get("/runtime", (_request, response) => {
    const view = agent.view;
    response.set("Cache-Control", "no-store").json({
      mode: "server", observedAt: new Date().toISOString(), uptimeSeconds: Math.floor(process.uptime()),
      eventAgent: { enabled: view.policy.enabled, processing: view.processing, error: Boolean(view.error) },
      portfolioWatch: { enabled: Boolean(portfolioWatch?.view?.enabled) },
    });
  });
  router.get("/model-settings", async (_request, response) => {
    try { response.set("Cache-Control", "no-store").json(await modelConfig.view()); }
    catch { response.status(503).json({ error: "模型配置无法读取，请检查服务端配置文件" }); }
  });
  router.put("/model-settings", async (request, response) => {
    try {
      if (process.env.LP_PORTFOLIO_AI_PROVIDER === "disabled") return response.status(403).json({ error: "当前运行环境未启用 AI 模型" });
      const settings = await modelConfig.save(request.body);
      agent.changes.emit("change");
      response.set("Cache-Control", "no-store").json(settings);
    } catch (error) {
      const message = error instanceof Error && /^(模型|请|不能|本机)/.test(error.message) ? error.message : "模型设置无法保存，请检查本地目录权限";
      response.status(400).json({ error: message });
    }
  });
  router.post("/model-settings/test", async (request, response) => {
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body) || Object.keys(request.body).length) return response.status(400).json({ error: "测试参数无效" });
    if (testingModel) return response.status(429).json({ error: "模型测试正在进行，请稍候" });
    testingModel = true;
    try { response.set("Cache-Control", "no-store").json(await testModel()); }
    catch (error) { response.status(502).json({ error: error instanceof Error && /^(模型|Codex|请)/.test(error.message) ? error.message : "模型连接测试未完成" }); }
    finally { testingModel = false; }
  });
  router.get("/stream", (request, response) => {
    response.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
    response.flushHeaders();
    const send = () => { if (!response.writableNeedDrain) response.write(`event: state\ndata: ${JSON.stringify(agent.view)}\n\n`); };
    send();
    agent.changes.on("change", send);
    const heartbeat = setInterval(() => { response.write(": heartbeat\n\n"); }, 15_000);
    request.on("close", () => { clearInterval(heartbeat); agent.changes.off("change", send); });
  });
  router.patch("/policy", async (request, response) => {
    try { response.json(await agent.configure(request.body)); }
    catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "策略设置失败" }); }
  });
  router.post("/review/:positionId", async (request, response) => {
    try { response.status(202).json(await agent.review(String(request.params.positionId))); }
    catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "评估请求失败" }); }
  });
  router.post("/demo", async (_request, response) => {
    try { response.status(202).json(await agent.demo()); }
    catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "演练启动失败" }); }
  });
  router.post("/plans/:planId/simulate", async (request, response) => {
    try { response.json(await agent.simulate(String(request.params.planId), request.body)); }
    catch (error) { response.status(409).json({ error: error instanceof Error ? error.message : "模拟失败" }); }
  });
  if (evaluation) {
    router.get("/evaluation", (_request, response) => response.json({ report: evaluation.view ?? null }));
    router.post("/evaluation", async (_request, response) => {
      try { response.status(202).json({ report: await evaluation.start() }); }
      catch (error) { response.status(409).json({ error: error instanceof Error ? error.message : "无法开始测评" }); }
    });
  }
  if (portfolioWatch) {
    router.get("/portfolio-watch", async (_request, response) => {
      try { await getDwsRecipient(); response.json({ watch: portfolioWatch.view, dwsReady: true }); }
      catch (error) { response.json({ watch: portfolioWatch.view, dwsReady: false, dwsMessage: error instanceof Error ? error.message : "钉钉暂不可用" }); }
    });
    router.post("/portfolio-watch", async (request, response) => {
      try { response.json({ watch: await portfolioWatch.configure(request.body) }); }
      catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "监控设置失败" }); }
    });
  }
  router.use(portfolioRoutes());
  return router;
}
