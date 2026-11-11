export const agentPages = [
  { id: "model", href: "#agent-model", label: "模型与运行", description: "模型连接与用量", localOnly: true },
  { id: "evaluation", href: "#agent-evaluation", label: "Agent 测评", description: "测评结果与风控", localOnly: true },
  { id: "samples", href: "#agent-samples", label: "样本数据", description: "LP 与 Top 50 历史样本", localOnly: false },
] as const;

export type AgentPage = typeof agentPages[number]["id"];

export function agentPageFromHash(hash: string, local: boolean): AgentPage | null {
  if (hash === "#agent-workbench") return local ? "model" : "samples";
  return agentPages.find(item => item.href === hash)?.id ?? null;
}
