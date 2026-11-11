export const modelProviders = ["codex", "deepseek", "glm", "compatible"] as const;
export type ModelProvider = typeof modelProviders[number];

export interface ModelPricing {
  currency: "USD" | "CNY";
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion?: number;
}

export interface ModelUsage {
  provider: ModelProvider | "gateway";
  model: string;
  purpose: "portfolio" | "strategy" | "connection-test";
  at: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  estimatedCost?: number;
  currency?: ModelPricing["currency"];
}

export interface ModelProfileView {
  provider: ModelProvider;
  label: string;
  model: string;
  baseUrl: string;
  keyConfigured: boolean;
  keySource: "local" | "environment" | "none";
  pricing?: ModelPricing;
}

export interface ModelSettingsView {
  selected: ModelProvider | "gateway" | "disabled";
  profiles: ModelProfileView[];
  recentUsage: ModelUsage[];
  runtime: "server";
}

export interface ModelSettingsInput {
  provider: ModelProvider;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  pricing?: ModelPricing | null;
}

export interface AgentRuntimeView {
  mode: "server";
  observedAt: string;
  uptimeSeconds: number;
  eventAgent: { enabled: boolean; processing: boolean; error: boolean };
  portfolioWatch: { enabled: boolean };
}
