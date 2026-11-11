import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, RefreshCw, Wrench } from "lucide-react";
import { localCodexLaunchUrl, localCodexUrl, type LocalCodexStatus } from "../shared/local-codex";
import type { PortfolioAdvice, PortfolioSourceId } from "../shared/portfolio";
import "./local-codex.css";

async function localRequest(path: string, signal: AbortSignal, token?: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${localCodexUrl}${path}`, {
    method: body === undefined ? "GET" : "POST", signal, credentials: "omit", cache: "no-store",
    headers: { ...body === undefined ? {} : { "Content-Type": "application/json" }, ...token ? { "X-LP-Bridge-Token": token } : {} },
    ...body === undefined ? {} : { body: JSON.stringify(body) },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "本机 API 暂不可用");
  return result;
}

function readStatus(value: unknown): LocalCodexStatus {
  const data = value as LocalCodexStatus;
  if (data?.service !== "lp-sentinel-codex" || data.version !== 1 || !["checking", "ready", "needs-login", "missing-cli", "error"].includes(data.phase) || typeof data.message !== "string" || data.message.length > 500 || typeof data.sessionToken !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(data.sessionToken) || !Number.isFinite(Date.parse(data.checkedAt)) || data.phase === "ready" && (!data.verifiedAt || !Number.isFinite(Date.parse(data.verifiedAt)))) throw new Error("本机 API 响应未通过校验");
  return data;
}

export function useLocalCodex(enabled = true) {
  const [status, setStatus] = useState<LocalCodexStatus>();
  const [checked, setChecked] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [message, setMessage] = useState("");
  const alive = useRef(false);
  const repairingRef = useRef(false);
  const current = useRef<LocalCodexStatus | undefined>(undefined);
  const healthAbort = useRef<AbortController | null>(null);
  const repairAbort = useRef<AbortController | null>(null);

  const check = useCallback(async () => {
    if (repairingRef.current || healthAbort.current) return;
    const controller = new AbortController(); healthAbort.current = controller;
    try {
      const data = readStatus(await localRequest("/api/local/status", AbortSignal.any([controller.signal, AbortSignal.timeout(3_500)])));
      if (alive.current && !controller.signal.aborted) { current.current = data; setStatus(data); setMessage(""); }
    } catch {
      if (alive.current && !controller.signal.aborted) { current.current = undefined; setStatus(undefined); }
    } finally {
      if (healthAbort.current === controller) healthAbort.current = null;
      if (alive.current && !controller.signal.aborted) setChecked(true);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    alive.current = true;
    let timer: number;
    const poll = async () => { await check(); if (alive.current) timer = window.setTimeout(poll, 10_000); };
    const visible = () => { if (document.visibilityState === "visible") void check(); };
    void poll();
    document.addEventListener("visibilitychange", visible);
    return () => { alive.current = false; window.clearTimeout(timer); document.removeEventListener("visibilitychange", visible); healthAbort.current?.abort(); healthAbort.current = null; repairAbort.current?.abort(); };
  }, [check, enabled]);

  const repair = async () => {
    if (repairingRef.current) return;
    repairingRef.current = true; setRepairing(true); setMessage(""); healthAbort.current?.abort();
    const controller = new AbortController(); repairAbort.current = controller;
    let launched = !current.current;
    try {
      if (launched) window.location.href = localCodexLaunchUrl;
      let connected: LocalCodexStatus | undefined;
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline && !controller.signal.aborted) {
        try { connected = readStatus(await localRequest("/api/local/status", AbortSignal.any([controller.signal, AbortSignal.timeout(2_000)]))); break; }
        catch {
          if (controller.signal.aborted) return;
          if (!launched) { window.location.href = localCodexLaunchUrl; launched = true; }
          await new Promise(resolve => window.setTimeout(resolve, 1_000));
        }
      }
      if (controller.signal.aborted) return;
      if (!connected) throw new Error("本机 API 尚未连通。请手动打开“LP Sentinel Codex”启动器。首次使用可在本机运行 npm run codex:install。");
      if (alive.current) { current.current = connected; setStatus(connected); setChecked(true); }
      const data = readStatus(await localRequest("/api/local/repair", AbortSignal.any([controller.signal, AbortSignal.timeout(100_000)]), connected.sessionToken, {}));
      if (alive.current && !controller.signal.aborted) { current.current = data; setStatus(data); setMessage(data.phase === "ready" ? "" : data.message); }
    } catch (error) {
      if (alive.current && !controller.signal.aborted) setMessage(error instanceof Error ? error.message : "本机连接修复未完成，请重试");
    } finally {
      repairingRef.current = false;
      if (alive.current) { setRepairing(false); setChecked(true); }
    }
  };

  const analyze = async (address: string, sourceId: PortfolioSourceId, positionKey: string, signal: AbortSignal) => {
    if (repairingRef.current) throw new Error("本机 Codex 连接正在修复，请稍候");
    if (current.current?.phase !== "ready") throw new Error("本机 Codex 尚未 ready，请先修复连接");
    return await localRequest("/api/agent/analyze", signal, current.current.sessionToken, { address, sourceId, positionKey }) as PortfolioAdvice;
  };
  return { status, checked, repairing, message, ready: !repairing && status?.phase === "ready", check, repair, analyze };
}

export function LocalCodexConnection({ connection, developmentConnection }: {
  connection: ReturnType<typeof useLocalCodex>;
  developmentConnection?: { checking: boolean; available: boolean; label: string; check: () => void };
}) {
  const checking = developmentConnection ? developmentConnection.checking : connection.repairing;
  let phase: LocalCodexStatus["phase"] | "offline" = connection.status?.phase ?? (connection.checked ? "offline" : "checking");
  if (developmentConnection) phase = checking ? "checking" : developmentConnection.available ? "ready" : "error";
  else if (connection.repairing) phase = "checking";
  const labels = { checking: "本机 Codex 检测中", ready: "本机 Codex ready", offline: "本机 API 未连接", "needs-login": "本机 Codex 待登录", "missing-cli": "本机 CLI 未安装", error: "本机 Codex 待修复" };
  const title = developmentConnection
    ? "每 10 秒检测本地分析服务及所选模型配置；实际调用请在模型设置中测试"
    : connection.status ? `${connection.status.message} · ${new Date(connection.status.checkedAt).toLocaleTimeString("zh-CN", { hour12: false })}` : "每 10 秒检测这台电脑的本机 API";
  const action = developmentConnection ? "检测" : "修复";
  return <div className="local-codex-connection">
    <div className="local-codex-line">
      <span className={`local-codex-status ${phase}`} role="status" title={title}>
        {phase === "checking" ? <LoaderCircle size={12} className="spin" /> : <i aria-hidden="true" />}
        {developmentConnection && !checking ? developmentConnection.available ? "本地 Codex 已登录" : developmentConnection.label : labels[phase]}
      </span>
      <button type="button" onClick={developmentConnection ? developmentConnection.check : () => void connection.repair()} disabled={checking} aria-label={developmentConnection ? "重新检测本地分析服务" : "修复本机 Codex 连接"}>
        {developmentConnection ? <RefreshCw size={12} /> : <Wrench size={12} />}
        {checking ? `${action}中` : action}
      </button>
    </div>
    {!developmentConnection && (connection.message || phase === "needs-login" || phase === "missing-cli") && <p className="local-codex-message" role="alert">{connection.message || connection.status?.message}</p>}
  </div>;
}
