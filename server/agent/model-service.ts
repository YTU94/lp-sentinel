import { generateText, jsonSchema, Output } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ModelUsage } from "../../shared/model.js";
import type { PortfolioAiStatus } from "../../shared/portfolio.js";
import { inspectCodexCli, runCodexJsonWithUsage } from "./codex-cli.js";
import { modelConfig, type ActiveModel } from "./model-config.js";

let codexStatus: { at: number; value: Awaited<ReturnType<typeof inspectCodexCli>> } | undefined;

async function statusFor(active: ActiveModel, gatewayToken?: string): Promise<PortfolioAiStatus> {
  if (active.provider === "disabled") return { provider: "unavailable", available: false, label: "AI 优化未启用，地址查仓与历史样本可用" };
  if (active.provider === "codex") {
    if (!codexStatus || Date.now() - codexStatus.at >= 30_000) codexStatus = { at: Date.now(), value: await inspectCodexCli() };
    const cli = codexStatus.value;
    return { provider: "codex", available: cli.installed && cli.authenticated && cli.compatible,
      label: cli.installed && cli.authenticated && !cli.compatible ? "本机 Codex 版本缺少安全隔离能力，请完成更新后重试" : cli.installed && cli.authenticated ? "本机 Codex" : "请在本机安装并登录 Codex" };
  }
  const key = active.apiKey || (active.provider === "gateway" ? gatewayToken : undefined);
  const local = active.baseUrl ? ["localhost", "127.0.0.1", "[::1]"].includes(new URL(active.baseUrl).hostname) : false;
  const available = Boolean(active.model && active.baseUrl && (key || local));
  const label = active.provider === "deepseek" ? "DeepSeek" : active.provider === "glm" ? "智谱 GLM" : active.provider === "gateway" ? "AI Gateway" : "兼容模型接口";
  return { provider: active.provider, available, label: available ? `${label} · 已配置` : `请在模型设置中完成 ${label} 配置` };
}

export async function modelStatus(gatewayToken?: string, active?: ActiveModel): Promise<PortfolioAiStatus> {
  return statusFor(active ?? await modelConfig.active(), gatewayToken);
}

export function modelConfigured() {
  if (!modelConfig.readable) return false;
  const active = modelConfig.activeSync();
  if (active.provider === "disabled") return false;
  if (active.provider === "codex") return true;
  const local = active.baseUrl ? ["localhost", "127.0.0.1", "[::1]"].includes(new URL(active.baseUrl).hostname) : false;
  return Boolean(active.model && active.baseUrl && (active.apiKey || local));
}

function estimate(usage: ModelUsage, active: ActiveModel) {
  const price = active.pricing;
  if (!price || usage.inputTokens === undefined || usage.outputTokens === undefined) return;
  if (price.cachedInputPerMillion !== undefined && usage.cachedInputTokens === undefined) return;
  if (usage.cachedInputTokens !== undefined && usage.cachedInputTokens > usage.inputTokens) return;
  if (usage.cachedInputTokens && price.cachedInputPerMillion === undefined) return;
  const cached = usage.cachedInputTokens ?? 0;
  usage.estimatedCost = ((usage.inputTokens - cached) * price.inputPerMillion + cached * (price.cachedInputPerMillion ?? price.inputPerMillion) + usage.outputTokens * price.outputPerMillion) / 1_000_000;
  usage.currency = price.currency;
}

export async function generateModelJson(options: {
  instruction: string; facts: unknown; schema: object; purpose: ModelUsage["purpose"]; gatewayToken?: string; active?: ActiveModel;
}) {
  const active = options.active ?? await modelConfig.active();
  const status = await statusFor(active, options.gatewayToken);
  if (active.provider === "disabled" || !status.available) throw new Error(status.label);
  const usage: ModelUsage = { provider: active.provider, model: active.model || "默认模型", purpose: options.purpose, at: new Date().toISOString() };
  let value: unknown;
  try {
    if (active.provider === "codex") {
      const result = await runCodexJsonWithUsage(`${options.instruction}\n仅输出符合 schema 的 JSON。数据：\n${JSON.stringify(options.facts)}`, options.schema, active.model || undefined);
      value = result.value;
      Object.assign(usage, result.usage);
    } else {
      const provider = createOpenAICompatible({ name: active.provider, baseURL: active.baseUrl, apiKey: active.apiKey || options.gatewayToken, supportsStructuredOutputs: active.provider === "gateway" });
      const result = await generateText({ model: provider(active.model), system: `${options.instruction}\n仅输出符合所要求结构的 JSON。`, prompt: JSON.stringify(options.facts),
        output: Output.object({ schema: jsonSchema(options.schema as Parameters<typeof jsonSchema>[0]) }), maxOutputTokens: 2048, maxRetries: 0, abortSignal: AbortSignal.timeout(60_000) });
      usage.inputTokens = result.usage.inputTokens;
      usage.outputTokens = result.usage.outputTokens;
      usage.cachedInputTokens = result.usage.inputTokenDetails?.cacheReadTokens;
      if (result.finishReason === "length") throw new Error("模型输出被截断，请调整模型或稍后重试");
      value = result.output;
      estimate(usage, active);
    }
  } catch (error) {
    if (error instanceof Error && /^(Codex|模型输出被截断)/.test(error.message)) throw error;
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode === 401 || statusCode === 403) throw new Error("模型认证失败，请检查 API Key 和接口权限");
    if (statusCode === 402) throw new Error("模型账户额度不足，请检查服务商账户");
    if (statusCode === 429) throw new Error("模型请求受到限流，请稍后重试");
    throw new Error("模型调用未完成，请检查接口地址、模型名称和网络后重试");
  }
  let usageSaved = true;
  try { await modelConfig.record(usage); } catch { usageSaved = false; }
  return { value, usage, usageSaved };
}

export async function testModel() {
  const result = await generateModelJson({ instruction: "连接验证。仅返回 ready 为 true 的 JSON。", facts: { check: "ready" }, purpose: "connection-test",
    schema: { type: "object", additionalProperties: false, properties: { ready: { type: "boolean", enum: [true] } }, required: ["ready"] } });
  if (!result.value || typeof result.value !== "object" || (result.value as { ready?: unknown }).ready !== true) throw new Error("模型连接验证未返回预期结果");
  return { ok: true, usage: result.usage, usageSaved: result.usageSaved };
}
