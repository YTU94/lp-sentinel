export type StrategyAction = "hold" | "recenter" | "reduce";
export type MarketZone = "safe" | "edge" | "outside" | "unavailable";

export interface AgentPolicy {
  enabled: boolean;
  planner: "rules" | "model";
  cooldownSeconds: number;
  maxCostBps: number;
  maxPriceDriftBps: number;
}

export interface MarketContext {
  positionId: string;
  name: string;
  source: string;
  quoteAsset: string;
  demo: boolean;
  enabled: boolean;
  price: number;
  lower: number;
  upper: number;
  valueQuote: number;
  observedAt: string;
  blockNumber?: string;
  zone: MarketZone;
}

export interface StrategyCandidate {
  action: StrategyAction;
  title: string;
  tradeoff: string;
  lower?: number;
  upper?: number;
}

export interface AgentEvent {
  id: string;
  type: "position.observed" | "range.changed" | "price.moved" | "data.unavailable" | "review.requested" | "demo.requested";
  createdAt: string;
  context: MarketContext;
  status: "pending" | "processing" | "completed" | "failed";
  attempts: number;
  trace: { step: string; detail: string; at: string }[];
  error?: string;
}

export interface StrategyPlan {
  id: string;
  eventId: string;
  createdAt: string;
  context: MarketContext;
  action: StrategyAction;
  reason: string;
  planner: "rules" | "model";
  candidates: StrategyCandidate[];
  status: "observing" | "ready" | "blocked" | "simulated";
  checks: { label: string; passed: boolean }[];
  modelUsage?: import("./model.js").ModelUsage;
  usageSaved?: boolean;
  simulation?: {
    at: string;
    price: number;
    gasQuote: number;
    slippageBps: number;
    estimatedCostQuote: number;
    valueAfterCostsQuote: number;
    reflection: string;
  };
}

export interface AgentState {
  policy: AgentPolicy;
  events: AgentEvent[];
  plans: StrategyPlan[];
  observed: Record<string, { signature: string; price: number; blockNumber?: string }>;
  lastSimulatedAt: Record<string, string>;
}

export interface AgentView {
  policy: AgentPolicy;
  events: AgentEvent[];
  plans: StrategyPlan[];
  modelConfigured: boolean;
  processing: boolean;
  error?: string;
}
