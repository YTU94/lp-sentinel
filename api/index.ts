import express from "express";
import { portfolioRoutes } from "../server/agent/portfolio-routes.js";

const app = express();
app.disable("x-powered-by");
app.use((_request, response, next) => { response.set("Cache-Control", "no-store"); next(); });
app.use((request, response, next) => {
  const allowedHosts = [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL, process.env.VERCEL_BRANCH_URL].filter(Boolean);
  const host = request.get("host");
  if (!host || !allowedHosts.includes(host)) return response.status(403).json({ error: "请求主机无效" });
  if (request.method !== "GET") {
    try {
      const origin = request.get("origin");
      if (origin && new URL(origin).origin !== `https://${host}`) return response.status(403).json({ error: "不接受跨站分析操作" });
    } catch { return response.status(403).json({ error: "请求来源无效" }); }
    if (!request.is("application/json")) return response.status(415).json({ error: "请使用 JSON 请求" });
  }
  next();
});
app.use(express.json({ limit: "16kb" }));
app.use("/api/agent", portfolioRoutes());
app.use((_request, response) => response.status(404).json({ error: "此云端入口仅提供地址查仓、历史样本和按需分析" }));

export default app;
