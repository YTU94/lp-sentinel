import express from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LocalCodexStatus } from "../shared/local-codex.js";
import { codexLastFailureAt, inspectCodexCli, runCodexJson, stopCodexCalls } from "./agent/codex-cli.js";
import { portfolioRoutes } from "./agent/portfolio-routes.js";

process.env.LP_PORTFOLIO_AI_PROVIDER = "codex";
process.env.LP_AGENT_FORCE_CODEX = "1";
const script = fileURLToPath(import.meta.url);
const pidPath = resolve(dirname(script), "../data/local-codex.pid");
const origins = new Set(["https://lp-sentinel.vercel.app", "http://127.0.0.1:1422", "http://localhost:1422"]);
const token = randomBytes(32).toString("base64url");
let state: Omit<LocalCodexStatus, "sessionToken"> = { service: "lp-sentinel-codex", version: 1, phase: "checking", message: "正在验证本机 Codex 调用", checkedAt: new Date().toISOString() };
let authCheckedAt = 0;
let repairing: Promise<void> | undefined;

async function checkInstallation() {
  const cli = await inspectCodexCli();
  authCheckedAt = Date.now();
  state = { ...state, cliVersion: cli.cliVersion, checkedAt: new Date().toISOString() };
  if (!cli.installed) state = { ...state, phase: "missing-cli", message: "未找到 Codex CLI，请在本机安装后点击修复" };
  else if (!cli.authenticated) state = { ...state, phase: "needs-login", message: "请在本机完成 codex login，然后点击修复" };
  else if (!cli.compatible) state = { ...state, phase: "error", message: "本机 Codex 版本缺少安全隔离能力，请完成更新后修复" };
  return cli.installed && cli.authenticated && cli.compatible;
}

function repair() {
  return repairing ??= (async () => {
    state = { ...state, phase: "checking", message: "正在验证本机 Codex 调用", checkedAt: new Date().toISOString() };
    try {
      if (!await checkInstallation()) return;
      const result = await runCodexJson("连接验证。请仅返回 ready 为 true 的 JSON。", { type: "object", additionalProperties: false, properties: { ready: { type: "boolean", enum: [true] } }, required: ["ready"] });
      if (result?.ready !== true) throw new Error("Codex 就绪响应校验失败");
      state = { ...state, phase: "ready", message: "本机 API、CLI 登录与实际调用验证通过", verifiedAt: new Date().toISOString(), checkedAt: new Date().toISOString() };
    } catch {
      state = { ...state, phase: "error", message: "Codex 调用验证失败，请检查本机网络、登录或额度后修复", checkedAt: new Date().toISOString() };
    }
  })().finally(() => { repairing = undefined; });
}

async function status(): Promise<LocalCodexStatus> {
  if (state.phase === "ready" && codexLastFailureAt() > Date.parse(state.verifiedAt!)) state = { ...state, phase: "error", message: "最近一次 Codex 调用失败，请修复后重试", checkedAt: new Date().toISOString() };
  if (state.phase === "ready" && Date.now() - authCheckedAt > 30_000) await checkInstallation();
  return { ...state, sessionToken: token };
}

const app = express();
app.disable("x-powered-by");
app.use((request, response, next) => {
  response.set("Cache-Control", "no-store");
  const origin = request.get("origin");
  if (!["127.0.0.1:4318", "localhost:4318"].includes(request.get("host") || "") || origin !== undefined && !origins.has(origin)) return response.status(403).json({ error: "本机 API 不接受此来源" });
  if (origin) {
    response.set("Access-Control-Allow-Origin", origin);
    response.vary("Origin");
    response.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.set("Access-Control-Allow-Headers", "Content-Type, X-LP-Bridge-Token");
    response.set("Access-Control-Allow-Private-Network", "true");
  }
  if (request.method === "OPTIONS") return response.sendStatus(204);
  if (request.method === "GET" && request.path === "/api/local/status") return next();
  if (request.method !== "POST" || !["/api/local/repair", "/api/agent/analyze"].includes(request.path)) return response.status(404).json({ error: "本机 API 入口不存在" });
  const provided = Buffer.from(request.get("x-lp-bridge-token") || "");
  const expected = Buffer.from(token);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return response.status(401).json({ error: "本机连接已更新，请重新检测后重试" });
  if (!request.is("application/json")) return response.status(415).json({ error: "请使用 JSON 请求" });
  next();
});
app.use(express.json({ limit: "16kb" }));
app.get("/api/local/status", async (_request, response) => response.json(await status()));
app.post("/api/local/repair", async (request, response) => {
  if (!request.body || Array.isArray(request.body) || Object.keys(request.body).length) return response.status(400).json({ error: "修复请求参数无效" });
  await status();
  if (state.phase !== "ready" || Date.now() - Date.parse(state.verifiedAt!) > 5_000) await repair();
  response.json(await status());
});
app.use("/api/agent/analyze", (_request, response, next) => {
  if (state.phase !== "ready") return response.status(503).json({ error: state.message });
  next();
});
app.use("/api/agent", portfolioRoutes());
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const status = (error as { status?: number })?.status;
  const code = status === 413 ? 413 : status === 400 ? 400 : 500;
  response.status(code).json({ error: code === 413 ? "请求超过本机 API 大小限制" : "本机 API 请求未完成，请重试" });
});

const server = app.listen(4318, "127.0.0.1", async () => {
  await mkdir(dirname(pidPath), { recursive: true });
  await writeFile(pidPath, JSON.stringify({ pid: process.pid, script }), { mode: 0o600 });
  console.log("LP Sentinel Codex API listening on 127.0.0.1:4318");
});
server.on("error", () => { console.error("本机 Codex API 启动失败，请检查 4318 端口"); process.exitCode = 1; });
async function shutdown() {
  stopCodexCalls();
  server.close();
  try { if (JSON.parse(await readFile(pidPath, "utf8")).pid === process.pid) await rm(pidPath); } catch { /* The service may stop before the PID file is written. */ }
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
