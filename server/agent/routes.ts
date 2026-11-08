import { Router } from "express";
import type { StrategyAgent } from "./runtime.js";
import { portfolioRoutes } from "./portfolio-routes.js";

export function agentRoutes(agent: StrategyAgent) {
  const router = Router();
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
  router.use(portfolioRoutes());
  return router;
}
