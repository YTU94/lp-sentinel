import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { modelProviders, type ModelPricing, type ModelProvider, type ModelSettingsInput, type ModelSettingsView, type ModelUsage } from "../../shared/model.js";

type Profile = { model: string; baseUrl: string; apiKey?: string; pricing?: ModelPricing };
type StoredSettings = { version: 1; selected?: ModelProvider; profiles: Partial<Record<ModelProvider, Profile>>; usage: ModelUsage[] };
export type ActiveModel = { provider: ModelProvider | "gateway" | "disabled"; model: string; baseUrl: string; apiKey?: string; pricing?: ModelPricing };

const defaults: Record<ModelProvider, Omit<Profile, "apiKey" | "pricing"> & { label: string }> = {
  codex: { label: "本机 Codex", model: "", baseUrl: "" },
  deepseek: { label: "DeepSeek", model: "deepseek-flash", baseUrl: "https://api.deepseek.com" },
  glm: { label: "智谱 GLM", model: "glm-5.3", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
  compatible: { label: "OpenAI 兼容接口", model: "", baseUrl: "" },
};
const empty: StoredSettings = { version: 1, profiles: {}, usage: [] };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultState = path.join(root, "data", "lp-sentinel.json");
const keyEnv: Record<ModelProvider, string | undefined> = {
  codex: undefined, deepseek: "DEEPSEEK_API_KEY", glm: "ZHIPU_API_KEY", compatible: "LP_COMPATIBLE_API_KEY",
};

function environmentKey(provider: ModelProvider) {
  const name = keyEnv[provider];
  return (name && process.env[name]) || (provider === "glm" ? process.env.ZAI_API_KEY : undefined) || undefined;
}

function safeBaseUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("模型接口地址无效"); }
  if (url.username || url.password || url.search || url.hash) throw new Error("模型接口地址不能包含凭据或查询参数");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error("模型接口须使用 HTTPS，本机接口可使用 HTTP");
  return url.toString().replace(/\/$/, "");
}

function validPricing(value: unknown): ModelPricing {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("模型单价格式无效");
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some(key => !["currency", "inputPerMillion", "outputPerMillion", "cachedInputPerMillion"].includes(key)) || !["USD", "CNY"].includes(String(data.currency))) throw new Error("模型单价格式无效");
  for (const key of ["inputPerMillion", "outputPerMillion", "cachedInputPerMillion"] as const) {
    const n = data[key];
    if (key === "cachedInputPerMillion" && n === undefined) continue;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1_000_000) throw new Error("模型单价须为非负数字");
  }
  return data as unknown as ModelPricing;
}

export class ModelConfig {
  private data: StoredSettings = structuredClone(empty);
  private loading?: Promise<void>;
  private queue: Promise<void> = Promise.resolve();
  private failed = false;
  revision = 0;

  get readable() { return !this.failed; }

  constructor(private readonly file = process.env.LP_AGENT_MODEL_CONFIG_FILE || path.join(path.dirname(process.env.LP_SENTINEL_DATA_FILE || defaultState), "agent-models.json")) {}

  async load() {
    return this.loading ??= (async () => {
      try {
        const data = JSON.parse(await readFile(this.file, "utf8")) as StoredSettings;
        if (data.version !== 1 || !data.profiles || typeof data.profiles !== "object" || Array.isArray(data.profiles) || !Array.isArray(data.usage) || data.selected && !modelProviders.includes(data.selected)) throw new Error("模型配置格式无效");
        for (const [name, profile] of Object.entries(data.profiles)) {
          if (!modelProviders.includes(name as ModelProvider) || !profile || typeof profile !== "object" || typeof profile.model !== "string" || profile.model.length > 160 || /[\r\n\0]/.test(profile.model) || typeof profile.baseUrl !== "string" || profile.apiKey !== undefined && (typeof profile.apiKey !== "string" || profile.apiKey.length > 4096 || /[\r\n\0]/.test(profile.apiKey))) throw new Error("模型配置格式无效");
          if (name === "codex" ? Boolean(profile.baseUrl || profile.apiKey || profile.pricing) : !profile.model || safeBaseUrl(profile.baseUrl) !== profile.baseUrl) throw new Error("模型配置格式无效");
          if (profile.pricing) validPricing(profile.pricing);
        }
        await chmod(this.file, 0o600);
        this.data = data;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") { this.failed = true; throw new Error("模型配置无法读取，请检查本地配置文件权限与格式"); }
      }
    })();
  }

  private selected() {
    if (process.env.LP_AGENT_FORCE_CODEX === "1") return "codex" as const;
    const env = process.env.LP_PORTFOLIO_AI_PROVIDER;
    if (env === "disabled") return "disabled" as const;
    return this.data.selected ?? (env === "gateway" ? "gateway" : modelProviders.includes(env as ModelProvider) ? env as ModelProvider : "codex");
  }

  activeSync(): ActiveModel {
    const provider = this.selected();
    if (provider === "disabled") return { provider, model: "", baseUrl: "" };
    if (provider === "gateway") return { provider, model: process.env.LP_AGENT_MODEL || "", baseUrl: "https://ai-gateway.vercel.sh/v1", apiKey: process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN };
    const saved = this.data.profiles[provider];
    return { provider, model: saved?.model ?? defaults[provider].model, baseUrl: saved?.baseUrl ?? defaults[provider].baseUrl, apiKey: saved?.apiKey || environmentKey(provider), pricing: saved?.pricing };
  }

  async active() {
    if (process.env.LP_PORTFOLIO_AI_PROVIDER === "disabled" && process.env.LP_AGENT_FORCE_CODEX !== "1") return { provider: "disabled", model: "", baseUrl: "" } as ActiveModel;
    await this.load();
    return this.activeSync();
  }

  async view(): Promise<ModelSettingsView> {
    await this.load();
    return {
      selected: this.selected(), runtime: "server",
      profiles: modelProviders.map(provider => {
        const saved = this.data.profiles[provider];
        return { provider, label: defaults[provider].label, model: saved?.model ?? defaults[provider].model, baseUrl: saved?.baseUrl ?? defaults[provider].baseUrl,
          keyConfigured: Boolean(saved?.apiKey || environmentKey(provider)), keySource: saved?.apiKey ? "local" : environmentKey(provider) ? "environment" : "none", pricing: saved?.pricing };
      }),
      recentUsage: [...this.data.usage].reverse().slice(0, 100),
    };
  }

  async save(input: unknown) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("模型设置格式无效");
    const value = input as ModelSettingsInput;
    if (Object.keys(value).some(key => !["provider", "model", "baseUrl", "apiKey", "clearApiKey", "pricing"].includes(key)) || !modelProviders.includes(value.provider)) throw new Error("模型提供方无效");
    if (value.model !== undefined && (typeof value.model !== "string" || value.model.length > 160 || /[\r\n\0]/.test(value.model))) throw new Error("模型名称无效");
    if (value.apiKey !== undefined && (typeof value.apiKey !== "string" || value.apiKey.length > 4096 || /[\r\n\0]/.test(value.apiKey))) throw new Error("模型密钥格式无效");
    if (value.clearApiKey !== undefined && typeof value.clearApiKey !== "boolean") throw new Error("模型密钥设置无效");
    if (value.clearApiKey && value.apiKey?.trim()) throw new Error("不能同时更新和清除密钥");
    if (value.provider === "codex" && (value.apiKey || value.clearApiKey || value.baseUrl || value.pricing)) throw new Error("本机 Codex 使用已有登录态，无需填写接口密钥");
    if (value.baseUrl !== undefined && typeof value.baseUrl !== "string") throw new Error("模型接口地址无效");
    const pricing = value.pricing === undefined ? undefined : value.pricing === null ? null : validPricing(value.pricing);
    await this.change(data => {
      const previous = data.profiles[value.provider];
      const model = value.model === undefined ? previous?.model ?? defaults[value.provider].model : value.model.trim();
      const rawUrl = value.baseUrl === undefined ? previous?.baseUrl ?? defaults[value.provider].baseUrl : value.baseUrl.trim();
      const baseUrl = value.provider === "codex" ? "" : safeBaseUrl(rawUrl);
      if (value.provider !== "codex" && !model) throw new Error("请填写模型名称");
      const profile: Profile = { model, baseUrl };
      const apiKey = value.clearApiKey ? undefined : value.apiKey?.trim() || previous?.apiKey;
      if (apiKey) profile.apiKey = apiKey;
      if (pricing) profile.pricing = pricing;
      else if (pricing === undefined && previous?.pricing) profile.pricing = previous.pricing;
      data.selected = value.provider;
      data.profiles[value.provider] = profile;
    });
    this.revision++;
    return this.view();
  }

  async record(usage: ModelUsage) {
    if (process.env.LP_AGENT_DISABLE_USAGE === "1") return;
    await this.change(data => { data.usage = [...data.usage.slice(-99), usage]; });
  }

  private async change(mutator: (data: StoredSettings) => void) {
    await this.load();
    const operation = this.queue.then(async () => {
      const next = structuredClone(this.data);
      mutator(next);
      await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600, flag: "wx" });
        await rename(temporary, this.file);
      } finally { await rm(temporary, { force: true }); }
      this.data = next;
    });
    this.queue = operation.catch(() => undefined);
    await operation;
  }
}

export const modelConfig = new ModelConfig();
