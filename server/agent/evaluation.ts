import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { EvaluationReport } from "../../shared/evaluation.js";
import type { JsonStore } from "../store.js";
import { inspectCodexCli } from "./codex-cli.js";
import { evaluationDimensions, evaluationPlan } from "./evaluation-cases.js";
import { defaultAgentPolicy } from "./runtime.js";

export class AgentEvaluation {
  private child?: ChildProcess;
  private current?: EvaluationReport;
  private starting = false;

  constructor(private readonly store: JsonStore) {}

  get view() { return this.current ?? this.store.snapshot.evaluation; }

  async recover() {
    if (this.store.snapshot.evaluation?.state !== "running") return;
    await this.store.update(data => {
      if (data.evaluation?.state === "running") {
        data.evaluation.state = "interrupted";
        data.evaluation.finishedAt = new Date().toISOString();
        data.evaluation.error = "服务重启导致测评中断，请重新运行。";
      }
    });
  }

  async start() {
    if (this.starting || this.child || this.view?.state === "running") throw new Error("测评正在运行，请等待完成");
    this.starting = true;
    try {
    const cli = await inspectCodexCli();
    if (!cli.installed || !cli.authenticated) throw new Error("请先安装并登录本机 Codex，再运行测评");
    if (!cli.compatible) throw new Error("本机 Codex 版本缺少安全隔离能力，请完成更新后重试");
    const policy = { ...(this.store.snapshot.agent?.policy ?? defaultAgentPolicy), enabled: true, planner: "rules" as const };
    const plan = evaluationPlan(policy);
    const tempRoot = await mkdtemp(join(tmpdir(), "lp-agent-evaluation-"));
    const report: EvaluationReport = {
      id: randomUUID(), state: "running", startedAt: new Date().toISOString(), completed: 0, total: plan.cases.length,
      framework: "LangChain OpenEvals 0.2.3", definitionHash: plan.definitionHash,
      policy: { cooldownSeconds: policy.cooldownSeconds, maxCostBps: policy.maxCostBps, maxPriceDriftBps: policy.maxPriceDriftBps },
      plan: plan.cases, dimensions: evaluationDimensions.map(item => ({ ...item, score: null, evaluated: 0, total: 0 })), cases: [], recommendations: [],
    };
    try { await this.store.update(data => { data.evaluation = report; }); }
    catch (error) { await rm(tempRoot, { recursive: true, force: true }); throw error; }
    this.current = report;
    const child = fork(fileURLToPath(new URL("./evaluation-worker.ts", import.meta.url)), [], {
      execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: {
        ...process.env, LP_PORTFOLIO_AI_PROVIDER: "codex", LP_AGENT_FORCE_CODEX: "1", LP_AGENT_DISABLE_USAGE: "1", LANGSMITH_TRACING: "false", LANGCHAIN_TRACING_V2: "false", LANGSMITH_API_KEY: "", LANGCHAIN_API_KEY: "",
      },
    });
    this.child = child;
    let received = false;
    const finish = async (next: EvaluationReport) => {
      this.current = next;
      try { await this.store.update(data => { if (data.evaluation?.id === report.id) data.evaluation = next; }); }
      catch { this.current = { ...next, state: "failed", error: "测评结果无法保存，请检查本地数据目录。" }; }
    };
    child.on("message", (message: { type?: string; completed?: number; total?: number; result?: Pick<EvaluationReport, "cases" | "dimensions" | "recommendations">; error?: string }) => {
      if (message.type === "progress" && this.current?.id === report.id && this.current.state === "running") {
        this.current = { ...this.current, completed: Math.min(report.total, Math.max(0, message.completed ?? 0)) };
      } else if (message.type === "result" && message.result && !received) {
        received = true;
        void finish({ ...report, ...message.result, state: "completed", completed: report.total, finishedAt: new Date().toISOString() });
      } else if (message.type === "error" && !received) {
        received = true;
        void finish({ ...report, state: "failed", finishedAt: new Date().toISOString(), error: message.error || "测评未完成，请重试。" });
      }
    });
    child.once("exit", () => {
      this.child = undefined;
      if (!received) void finish({ ...report, state: "failed", finishedAt: new Date().toISOString(), error: "测评进程中断，请检查本机运行环境后重试。" });
      void rm(tempRoot, { recursive: true, force: true });
    });
    child.once("error", () => {
      if (!received) { received = true; void finish({ ...report, state: "failed", finishedAt: new Date().toISOString(), error: "无法启动测评进程，请检查本机运行环境。" }); }
    });
    child.send({ policy, tempRoot });
    return report;
    } finally { this.starting = false; }
  }
}
