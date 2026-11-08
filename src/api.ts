import type { AppState, Settings } from "./types";
import type { AgentPolicy, AgentView, StrategyPlan } from "../shared/agent";
import type { PortfolioAdvice, PortfolioAiStatus, PortfolioPage, PortfolioSourceId } from "../shared/portfolio";
import type { UniswapPoolUniverse } from "../shared/pool-universe";
import type { LpRangeActivity } from "../shared/range-activity";

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
  portfolioAiStatus: () => request<PortfolioAiStatus>("/api/agent/ai-status"),
  portfolioPage: (address: string, sourceId: PortfolioSourceId, cursor: string | undefined, signal: AbortSignal) => request<PortfolioPage>(`/api/agent/wallet/${encodeURIComponent(address)}?${new URLSearchParams({ sourceId, ...cursor ? { cursor } : {} })}`, { signal }),
  portfolioAnalyze: (address: string, sourceId: PortfolioSourceId, positionKey: string, signal: AbortSignal) => request<PortfolioAdvice>("/api/agent/analyze", { method: "POST", body: JSON.stringify({ address, sourceId, positionKey }), signal }),
  agent: () => request<AgentView>("/api/agent"),
  agentPolicy: (policy: Partial<AgentPolicy>) => request<AgentView>("/api/agent/policy", { method: "PATCH", body: JSON.stringify(policy) }),
  agentReview: (id: string) => request<{ eventId: string }>(`/api/agent/review/${encodeURIComponent(id)}`, { method: "POST", body: "{}" }),
  agentDemo: () => request<{ eventId: string }>("/api/agent/demo", { method: "POST", body: "{}" }),
  agentSimulate: (id: string, gasQuote: number, slippageBps: number) => request<StrategyPlan>(`/api/agent/plans/${encodeURIComponent(id)}/simulate`, { method: "POST", body: JSON.stringify({ gasQuote, slippageBps }) }),
  state: () => request<AppState>("/api/state"),
  updateSettings: (settings: Settings) => request("/api/settings", { method: "PATCH", body: JSON.stringify(settings) }),
  refresh: () => request("/api/refresh", { method: "POST" }),
};
