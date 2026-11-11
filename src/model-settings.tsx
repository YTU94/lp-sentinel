import { useEffect, useState, type FormEvent } from "react";
import { ChevronRight, CircleAlert, Cpu, LoaderCircle } from "lucide-react";
import type { AgentRuntimeView, ModelPricing, ModelProfileView, ModelProvider, ModelSettingsInput, ModelSettingsView, ModelUsage } from "../shared/model";
import { api } from "./api";
import "./model-settings.css";

type Draft = { provider: ModelProvider; model: string; baseUrl: string; apiKey: string; pricing: boolean; currency: ModelPricing["currency"]; inputPrice: string; outputPrice: string; cachePrice: string };
const blank: Draft = { provider: "codex", model: "", baseUrl: "", apiKey: "", pricing: false, currency: "USD", inputPrice: "", outputPrice: "", cachePrice: "" };
const purpose = { portfolio: "仓位分析", strategy: "事件策略", "connection-test": "连接测试" };

function fromProfile(profile: ModelProfileView): Draft {
  return { provider: profile.provider, model: profile.model, baseUrl: profile.baseUrl, apiKey: "", pricing: Boolean(profile.pricing), currency: profile.pricing?.currency ?? "USD",
    inputPrice: profile.pricing ? String(profile.pricing.inputPerMillion) : "", outputPrice: profile.pricing ? String(profile.pricing.outputPerMillion) : "", cachePrice: profile.pricing?.cachedInputPerMillion === undefined ? "" : String(profile.pricing.cachedInputPerMillion) };
}

export function ModelSettings({ onChanged, initiallyOpen = false }: { onChanged: () => void; initiallyOpen?: boolean }) {
  const [expanded, setExpanded] = useState(initiallyOpen);
  const [settings, setSettings] = useState<ModelSettingsView>();
  const [draft, setDraft] = useState<Draft>(blank);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [runtime, setRuntime] = useState<AgentRuntimeView | null>();
  const [usage, setUsage] = useState<ModelUsage[]>();
  const [usageLoading, setUsageLoading] = useState(true);
  const [usageError, setUsageError] = useState("");

  useEffect(() => {
    let alive = true;
    void api.modelSettings().then(value => {
      if (!alive) return;
      setSettings(value);
      setUsage(value.recentUsage); setUsageLoading(false);
      const profile = value.profiles.find(item => item.provider === value.selected) ?? value.profiles[0];
      if (profile) setDraft(fromProfile(profile));
    }).catch(() => { if (alive) { setError("无法读取模型设置，请检查本地服务。"); setUsageError("无法读取模型用量，请重试。"); setUsageLoading(false); } });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      try { const value = await api.agentRuntime(AbortSignal.any([controller.signal, AbortSignal.timeout(5_000)])); if (alive) setRuntime(value); }
      catch { if (alive) setRuntime(null); }
      if (alive) timer = setTimeout(() => void poll(), 10_000);
    };
    void poll();
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, []);

  const profile = settings?.profiles.find(item => item.provider === draft.provider);
  const selectedLabel = settings?.profiles.find(item => item.provider === settings.selected)?.label ?? (settings?.selected === "gateway" ? "AI Gateway" : settings?.selected === "disabled" ? "未启用" : "检查中");
  const dirty = !profile || settings?.selected !== draft.provider || draft.model !== profile.model || draft.baseUrl !== profile.baseUrl || Boolean(draft.apiKey)
    || JSON.stringify(draft.pricing ? { currency: draft.currency, inputPerMillion: Number(draft.inputPrice), outputPerMillion: Number(draft.outputPrice), ...(draft.cachePrice === "" ? {} : { cachedInputPerMillion: Number(draft.cachePrice) }) } : undefined) !== JSON.stringify(profile.pricing);

  const refreshUsage = async () => {
    setUsageLoading(true); setUsageError("");
    try {
      const value = await api.modelSettings();
      setUsage(value.recentUsage);
      if (!settings) {
        setSettings(value); setError("");
        const next = value.profiles.find(item => item.provider === value.selected) ?? value.profiles[0];
        if (next) setDraft(fromProfile(next));
      }
    }
    catch { setUsageError("无法读取模型用量，请重试。"); }
    finally { setUsageLoading(false); }
  };

  const save = async (event: FormEvent, clearApiKey = false) => {
    event.preventDefault(); setBusy(true); setMessage(""); setError("");
    try {
      const pricing = draft.pricing ? { currency: draft.currency, inputPerMillion: Number(draft.inputPrice), outputPerMillion: Number(draft.outputPrice), ...(draft.cachePrice === "" ? {} : { cachedInputPerMillion: Number(draft.cachePrice) }) } : null;
      const input: ModelSettingsInput = { provider: draft.provider, model: draft.model,
        ...(draft.provider !== "codex" ? { baseUrl: draft.baseUrl, pricing, ...(draft.apiKey ? { apiKey: draft.apiKey } : {}), ...(clearApiKey ? { clearApiKey: true } : {}) } : {}) };
      const value = await api.saveModelSettings(input);
      setSettings(value);
      setUsage(value.recentUsage); setUsageError("");
      const updated = value.profiles.find(item => item.provider === draft.provider);
      if (updated) setDraft(fromProfile(updated));
      setMessage(clearApiKey ? "已移除本地保存的密钥。" : "模型设置已保存并启用。");
      onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "模型设置保存失败。"); }
    finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true); setMessage(""); setError("");
    try {
      const result = await api.testModel();
      const value = await api.modelSettings();
      setSettings(value); setUsage(value.recentUsage); setUsageError("");
      setMessage(result.usageSaved ? "连接测试成功。" : "连接测试成功，但用量未能保存。");
      onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "连接测试失败。"); }
    finally { setBusy(false); }
  };

  return <details className="model-settings" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary><span><Cpu size={16} />模型与运行<ChevronRight className="model-settings-chevron" size={14} aria-hidden="true" /></span><small>{runtime === undefined ? "服务检查中" : runtime ? "服务在线" : "服务连接中断"} · {selectedLabel}</small></summary>
    <div className="model-settings-body">
      {runtime && <p role="status">服务端运行中 · 地址监控{runtime.portfolioWatch.enabled ? "已开启" : "未开启"} · 事件策略{runtime.eventAgent.error ? "异常" : !runtime.eventAgent.enabled ? "已暂停" : runtime.eventAgent.processing ? "分析中" : "等待事件"}。服务在线不代表数据源或通知正常，请查看对应状态。</p>}
      {runtime === null && <p role="alert" className="portfolio-error">无法连接本地服务，当前监控状态未知。</p>}
      <p>模型调用与监控运行在服务端进程。关闭浏览器后可继续运行；服务或主机停止后监控会停止。</p>
      <p>保存后，手动分析和已开启的自动提醒使用所选模型；脱敏仓位事实会发送给该模型服务，调用可能计费。</p>
      <form onSubmit={event => void save(event)}>
        <div className="model-settings-grid">
          <label>模型提供方<select value={draft.provider} disabled={!settings || busy} onChange={event => {
            const next = settings?.profiles.find(item => item.provider === event.target.value);
            if (next) { setDraft(fromProfile(next)); setError(""); setMessage(""); }
          }}>{settings?.profiles.map(item => <option key={item.provider} value={item.provider}>{item.label}</option>)}</select></label>
          <label>模型名称<input value={draft.model} maxLength={160} disabled={busy} onChange={event => setDraft({ ...draft, model: event.target.value })} placeholder={draft.provider === "codex" ? "留空使用默认模型" : "输入服务商的模型名称"} required={draft.provider !== "codex"} /></label>
          {draft.provider !== "codex" && <>
            <label className="model-settings-wide">接口地址<input type="url" value={draft.baseUrl} disabled={busy} onChange={event => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" required /></label>
            <label className="model-settings-wide">API Key <small>{profile?.keySource === "local" ? "已保存在服务端" : profile?.keySource === "environment" ? "已由环境变量配置" : "尚未配置"}</small><input type="password" autoComplete="new-password" value={draft.apiKey} disabled={busy} onChange={event => setDraft({ ...draft, apiKey: event.target.value })} placeholder={profile?.keyConfigured ? "留空保持现有密钥" : "填写密钥；本机接口可留空"} /></label>
          </>}
        </div>
        {draft.provider !== "codex" && <>
          <p>密钥以明文保存在运行服务的机器上，文件权限为 0600；页面不会回显密钥。接口使用 HTTPS，本机接口可使用 HTTP。</p>
          <details className="model-pricing"><summary>费用估算（可选）</summary>
            <label className="model-pricing-toggle"><input type="checkbox" checked={draft.pricing} onChange={event => setDraft({ ...draft, pricing: event.target.checked })} />按手动填写的单价估算</label>
            {draft.pricing && <div className="model-settings-grid">
              <label>币种<select value={draft.currency} onChange={event => setDraft({ ...draft, currency: event.target.value as ModelPricing["currency"] })}><option value="USD">USD</option><option value="CNY">CNY</option></select></label>
              <label>输入 / 百万 tokens<input type="number" min="0" step="any" required value={draft.inputPrice} onChange={event => setDraft({ ...draft, inputPrice: event.target.value })} /></label>
              <label>输出 / 百万 tokens<input type="number" min="0" step="any" required value={draft.outputPrice} onChange={event => setDraft({ ...draft, outputPrice: event.target.value })} /></label>
              <label>缓存输入 / 百万 tokens（可选）<input type="number" min="0" step="any" value={draft.cachePrice} onChange={event => setDraft({ ...draft, cachePrice: event.target.value })} /></label>
            </div>}
          </details>
        </>}
        <div className="model-settings-actions">
          <button className="primary-button" disabled={!settings || busy}>{busy && <LoaderCircle size={14} className="spin" />}保存并使用</button>
          <button className="wallet-button" type="button" disabled={!settings || busy || dirty} onClick={() => void test()}>测试已保存配置</button>
          {profile?.keySource === "local" && settings?.selected === draft.provider && !draft.apiKey && <button className="model-remove-key" type="button" disabled={busy || dirty} onClick={event => void save(event, true)}>移除本地密钥</button>}
        </div>
        <p>连接测试会发送一条合成请求，可能消耗模型额度；更改配置后请先保存。</p>
        {message && <p role="status" className="model-settings-success">{message}</p>}
        {error && <p role="alert" className="portfolio-error"><CircleAlert size={15} />{error}</p>}
      </form>
      <details className="model-usage" onToggle={event => { if (event.currentTarget.open) void refreshUsage(); }}><summary>最近模型用量 · {usageLoading ? "读取中" : usageError || !usage ? "暂不可用" : `已记录 ${usage.length} 次`}</summary>
        <p>仅记录统一模型接口的成功请求，保存最近 100 次并展示 10 次；测评、失败请求和订阅费用不包含在内，实际费用以服务商账单为准。</p>
        {usageError ? <p role="alert" className="portfolio-error">{usageError} <button className="model-remove-key" type="button" onClick={() => void refreshUsage()}>重试</button></p> : usageLoading ? <p role="status">正在读取用量…</p> : usage?.length ? <ul>{usage.slice(0, 10).map((item, index) => <li key={`${item.at}-${index}`}><span>{purpose[item.purpose]} · {item.provider} · {item.model}</span><span>{item.inputTokens === undefined || item.outputTokens === undefined ? "用量未返回" : `输入 ${item.inputTokens} / 输出 ${item.outputTokens} tokens`}{item.estimatedCost === undefined ? " · 费用未知" : ` · 估算 ${item.currency} ${item.estimatedCost.toFixed(6)}`}</span></li>)}</ul> : <p>暂无已记录的模型调用。</p>}
      </details>
    </div>
  </details>;
}
