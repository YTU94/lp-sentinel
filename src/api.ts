import type { AppState, Settings } from "./types";
import type { AgentPolicy, AgentView, StrategyPlan } from "../shared/agent";
import type { PortfolioAdvice, PortfolioAiStatus, PortfolioPage, PortfolioSourceId, PortfolioWatchState, PortfolioWatchView } from "../shared/portfolio";
import type { UniswapPoolUniverse } from "../shared/pool-universe";
import type { LpRangeActivity } from "../shared/range-activity";
import type { EvaluationReport } from "../shared/evaluation";
import type { AgentRuntimeView, ModelSettingsInput, ModelSettingsView, ModelUsage } from "../shared/model";
import type { SampleView } from "../shared/samples";

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "请求失败" })) as { error?: string };
    throw new Error(payload.error || `请求失败 (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  rangeActivity: (address: string, sourceId: PortfolioSourceId, positionKey: string, signal: AbortSignal, fresh = false) => request<LpRangeActivity>(`/api/agent/range-activity?${new URLSearchParams({ address, sourceId, positionKey, ...fresh ? { refresh: "1" } : {} })}`, { signal, cache: "no-cache" }),
  poolUniverse: (signal: AbortSignal) => request<UniswapPoolUniverse>("/api/agent/pool-universe", { signal }),
  samples: (signal?: AbortSignal) => request<SampleView>("/api/agent/samples", { signal, cache: "no-store" }),
  sampleWallet: (address: string | null, queriedAt: number, signal?: AbortSignal) => request<SampleView>("/api/agent/samples/wallet", { method: "PUT", body: JSON.stringify({ address, queriedAt }), signal }),
  refreshSamples: () => request<SampleView>("/api/agent/samples/refresh", { method: "POST", body: "{}" }),
  portfolioAiStatus: () => request<PortfolioAiStatus>("/api/agent/ai-status"),
  modelSettings: () => request<ModelSettingsView>("/api/agent/model-settings"),
  agentRuntime: (signal?: AbortSignal) => request<AgentRuntimeView>("/api/agent/runtime", { signal, cache: "no-store" }),
  saveModelSettings: (input: ModelSettingsInput) => request<ModelSettingsView>("/api/agent/model-settings", { method: "PUT", body: JSON.stringify(input) }),
  testModel: () => request<{ ok: true; usage: ModelUsage; usageSaved: boolean }>("/api/agent/model-settings/test", { method: "POST", body: "{}" }),
  portfolioWatch: () => request<PortfolioWatchView>("/api/agent/portfolio-watch"),
  configurePortfolioWatch: (input: { enabled: boolean; address?: string; clear?: boolean }) => request<{ watch?: PortfolioWatchState }>("/api/agent/portfolio-watch", { method: "POST", body: JSON.stringify(input) }),
  portfolioPage: (address: string, sourceId: PortfolioSourceId, cursor: string | undefined, signal: AbortSignal) => request<PortfolioPage>(`/api/agent/wallet/${encodeURIComponent(address)}?${new URLSearchParams({ sourceId, ...cursor ? { cursor } : {} })}`, { signal }),
  portfolioAnalyze: (address: string, sourceId: PortfolioSourceId, positionKey: string, signal: AbortSignal) => request<PortfolioAdvice>("/api/agent/analyze", { method: "POST", body: JSON.stringify({ address, sourceId, positionKey }), signal }),
  agent: () => request<AgentView>("/api/agent"),
  agentPolicy: (policy: Partial<AgentPolicy>) => request<AgentView>("/api/agent/policy", { method: "PATCH", body: JSON.stringify(policy) }),
  agentReview: (id: string) => request<{ eventId: string }>(`/api/agent/review/${encodeURIComponent(id)}`, { method: "POST", body: "{}" }),
  agentDemo: () => request<{ eventId: string }>("/api/agent/demo", { method: "POST", body: "{}" }),
  agentEvaluation: () => request<{ report: EvaluationReport | null }>("/api/agent/evaluation"),
  startAgentEvaluation: () => request<{ report: EvaluationReport }>("/api/agent/evaluation", { method: "POST", body: "{}" }),
  agentSimulate: (id: string, gasQuote: number, slippageBps: number) => request<StrategyPlan>(`/api/agent/plans/${encodeURIComponent(id)}/simulate`, { method: "POST", body: JSON.stringify({ gasQuote, slippageBps }) }),
  state: () => request<AppState>("/api/state"),
  updateSettings: (settings: Settings) => request("/api/settings", { method: "PATCH", body: JSON.stringify(settings) }),
  refresh: () => request("/api/refresh", { method: "POST" }),
};
