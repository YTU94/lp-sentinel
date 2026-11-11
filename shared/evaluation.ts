export type EvaluationDimensionId = "contract" | "grounding" | "risk" | "actionable" | "instruction" | "event" | "guardrail";

export interface EvaluationCheck {
  dimension: EvaluationDimensionId;
  score: number | null;
  reason: string;
  improvement?: string;
}

export interface EvaluationCaseResult {
  id: string;
  title: string;
  target: "策略建议" | "事件风控";
  status: "passed" | "failed" | "incomplete";
  evidence: string;
  checks: EvaluationCheck[];
}

export interface EvaluationReport {
  id: string;
  state: "running" | "completed" | "interrupted" | "failed";
  startedAt: string;
  finishedAt?: string;
  completed: number;
  total: number;
  framework: string;
  definitionHash: string;
  policy: { cooldownSeconds: number; maxCostBps: number; maxPriceDriftBps: number };
  plan: { id: string; title: string; target: "策略建议" | "事件风控"; purpose: string }[];
  dimensions: { id: EvaluationDimensionId; label: string; method: "规则断言" | "模型评审"; score: number | null; evaluated: number; total: number }[];
  cases: EvaluationCaseResult[];
  recommendations: string[];
  error?: string;
}
