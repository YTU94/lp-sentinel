import { useEffect, useState } from "react";
import { Bell, BellRing, CircleAlert, PhoneCall, Radar, RefreshCw, Settings2, ShieldCheck, X } from "lucide-react";
import { api } from "./api";
import type { AppState, Settings } from "./types";
import { PortfolioAgent } from "./portfolio-agent";

export default function App() {
  const cloud = import.meta.env.VITE_LP_RUNTIME === "cloud";
  const [state, setState] = useState<AppState>();
  const [panel, setPanel] = useState<"settings" | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = async (quiet = false) => {
    try {
      if (!quiet) setLoading(true);
      const next = await api.state();
      setState(next);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法连接监控服务");
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    if (cloud) return;
    void load();
    const timer = window.setInterval(() => void load(true), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!panel) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanel(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [panel]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main" aria-label="LP Sentinel 首页">
          <span className="brand-mark"><Radar size={21} /></span>
          <span>LP Sentinel</span>
        </a>
        <div className="system-status" aria-live="polite">
          <ShieldCheck size={15} />
          多链 LP · 地址查询
          <span className="divider" />
          {cloud ? "Top 50 历史样本" : state?.settings.dingCallEnabled ? <><PhoneCall size={15} /> 电话 DING</> : state?.settings.dingEnabled ? <><BellRing size={15} /> DING 已开启</> : <><Bell size={15} /> 普通提醒</>}
        </div>
        <div className="top-actions">
          {cloud ? <span className="portfolio-readonly"><ShieldCheck size={14} />云端只读</span> : <>
          <button className="icon-button refresh-button" disabled={refreshing} onClick={async () => { setRefreshing(true); try { await api.refresh(); await load(true); } finally { setRefreshing(false); } }} aria-label="立即刷新行情">
            <RefreshCw size={18} className={refreshing ? "spin" : ""} />
          </button>
          <button className="icon-button" onClick={() => setPanel("settings")} aria-label="报警设置"><Settings2 size={18} /></button>
          </>}
        </div>
      </header>

      {error && <div className="error-banner"><CircleAlert size={17} /><span>{error}</span><button onClick={() => setError("")} aria-label="关闭错误"><X size={16} /></button></div>}
      {loading && <div className="loading-line" role="status" aria-label="正在读取监控状态" />}

      <main id="main" className="workspace">
        <section className="chart-deck portfolio-deck" aria-label="策略 Agent">
          <PortfolioAgent positions={state?.positions ?? []} />
        </section>

        {panel && (
          <aside className="config-panel" role="region" aria-label="报警通道配置">
              <div className="panel-heading">
              <div><h2>报警通道</h2></div>
              <button className="icon-button" onClick={() => setPanel(null)} aria-label="关闭面板"><X size={18} /></button>
            </div>
            {error && <div className="panel-error" aria-live="assertive"><CircleAlert size={16} />{error}</div>}
            {state ? (
              <SettingsForm initial={state.settings} dws={state.dws} busy={saving} onSave={async (settings) => { setSaving(true); try { await api.updateSettings(settings); setPanel(null); await load(true); } catch (cause) { setError(cause instanceof Error ? cause.message : "设置保存失败"); } finally { setSaving(false); } }} />
            ) : null}
          </aside>
        )}
      </main>
    </div>
  );
}

function SettingsForm({ initial, dws, busy, onSave }: { initial: Settings; dws: AppState["dws"]; busy: boolean; onSave: (settings: Settings) => void }) {
  const [settings, setSettings] = useState(initial);
  return <form className="config-form" onSubmit={(event) => { event.preventDefault(); onSave(settings); }}>
    <div className={`connection-block ${dws.authenticated ? "connected" : ""}`}><span className="pulse online" /><div><strong>{dws.authenticated ? "DWS 已连接" : "DWS 未登录"}</strong><small>{dws.authenticated ? `${dws.corpName} · ${dws.userName} (${dws.userId})` : dws.error || "请在终端运行 dws auth login"}</small></div></div>
    <label><span>行情轮询间隔（秒）</span><input type="number" min="5" max="300" value={settings.pollIntervalSeconds} onChange={(e) => setSettings((v) => ({ ...v, pollIntervalSeconds: Number(e.target.value) }))} /></label>
    <div className="channel-row"><div><strong>钉钉私聊</strong><small>价格触界时，通过 DWS 给当前登录用户发送消息</small></div><span className="fixed-on">始终开启</span></div>
    <label className="channel-row switch-row"><div><strong>追加应用内 DING</strong><small>在普通私聊之外，再发送一条紧急 DING</small></div><input className="switch" type="checkbox" checked={settings.dingEnabled} onChange={(e) => setSettings((v) => ({ ...v, dingEnabled: e.target.checked }))} /></label>
    <label className="channel-row switch-row call-channel"><div><strong>追加电话 DING</strong><small>高优先级：预警线触界时向当前 DWS 用户发起电话提醒</small></div><input className="switch" type="checkbox" checked={settings.dingCallEnabled} onChange={(e) => setSettings((v) => ({ ...v, dingCallEnabled: e.target.checked }))} /></label>
    {(settings.dingEnabled || settings.dingCallEnabled) && <label><span>DING 机器人编码</span><input type="password" required autoComplete="off" placeholder="从开放平台机器人配置获取" value={settings.dingRobotCode} onChange={(e) => setSettings((v) => ({ ...v, dingRobotCode: e.target.value }))} /><small className="input-help">编码仅保存在本机 data/lp-sentinel.json 中。</small></label>}
    <p className={`form-note ${settings.dingCallEnabled ? "high-priority-note" : ""}`}><strong>注意：</strong>{settings.dingCallEnabled ? "电话 DING 可能产生通信费用；保存即表示允许后续真实触界告警拨打电话。" : "电话 DING 默认关闭；启用后只在真实价格触及预警线时调用。"}</p>
    <button className="primary-button submit" disabled={busy || !dws.authenticated}>{busy ? "正在保存…" : "保存报警设置"}</button>
  </form>;
}
