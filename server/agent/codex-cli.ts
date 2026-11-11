import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const children = new Set<ReturnType<typeof execFile>>();
let lastFailureAt = 0;
let inspection: Promise<{ installed: boolean; authenticated: boolean; compatible: boolean; cliVersion?: string }> | undefined;
export const codexBinary = () => process.env.LP_CODEX_BIN || "codex";
export const codexLastFailureAt = () => lastFailureAt;
export function stopCodexCalls() { for (const child of children) child.kill("SIGTERM"); }

export function inspectCodexCli() {
  return inspection ??= (async () => {
    const [version, login, features] = await Promise.allSettled([
      execute(codexBinary(), ["--version"], { timeout: 8_000, maxBuffer: 16_384 }),
      execute(codexBinary(), ["login", "status"], { timeout: 8_000, maxBuffer: 16_384 }),
      execute(codexBinary(), ["features", "list"], { timeout: 8_000, maxBuffer: 65_536 }),
    ]);
    const names = new Set(features.status === "fulfilled" ? features.value.stdout.split("\n").map(line => line.trim().split(/\s+/)[0]) : []);
    const compatible = ["shell_tool", "unified_exec", "apps", "plugins", "browser_use", "browser_use_external", "computer_use", "code_mode_host", "multi_agent", "hooks", "memories", "skill_search", "skip_host_skill_discovery"].every(name => names.has(name));
    return { installed: version.status === "fulfilled", authenticated: login.status === "fulfilled", compatible, cliVersion: version.status === "fulfilled" ? version.value.stdout.trim().slice(0, 80) : undefined };
  })().finally(() => { inspection = undefined; });
}

export function validateCodexEvents(events: { type?: string; message?: unknown; item?: { type?: string } }[]) {
  const completed = events.findIndex(event => event.type === "turn.completed");
  if (completed < 0 || events.some((event, index) => event.type === "turn.failed" ||
    event.type === "error" && !(index < completed && typeof event.message === "string" && /^Reconnecting\.\.\. \d+\/\d+ \(.*\)$/.test(event.message)) ||
    event.item && ["command_execution", "mcp_tool_call", "web_search", "file_change"].includes(event.item.type || ""))) {
    throw new Error("Codex 工具边界校验失败");
  }
}

export async function runCodexJsonWithUsage(prompt: string, schema: unknown, model?: string) {
  const directory = await mkdtemp(join(tmpdir(), "lp-advice-"));
  try {
    const schemaPath = join(directory, "schema.json");
    const outputPath = join(directory, "advice.json");
    await Promise.all([writeFile(schemaPath, JSON.stringify(schema), { mode: 0o600 }), writeFile(outputPath, "", { mode: 0o600 })]);
    const args = [
      "exec", "--ignore-user-config", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only",
      "--disable", "shell_tool", "--disable", "unified_exec", "--disable", "apps", "--disable", "plugins",
      "--disable", "browser_use", "--disable", "browser_use_external", "--disable", "computer_use",
      "--disable", "code_mode_host", "--disable", "multi_agent", "--disable", "hooks", "--disable", "memories",
      "--disable", "skill_search", "--enable", "skip_host_skill_discovery",
      "--config", 'web_search="disabled"', "--config", 'approval_policy="never"',
      "--config", 'model_reasoning_effort="low"',
      ...(model ? ["--model", model] : []),
      "--cd", directory, "--output-schema", schemaPath, "--output-last-message", outputPath, "--json", "-",
    ];
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = execFile(codexBinary(), args, { cwd: directory, timeout: 90_000, maxBuffer: 512_000, killSignal: "SIGTERM" }, (error, output) => {
        children.delete(child);
        if (error) reject(error); else resolve(output);
      });
      children.add(child);
      child.stdin?.end(prompt);
    });
    const events = stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
    validateCodexEvents(events);
    const rawUsage = events.find(event => event.type === "turn.completed")?.usage;
    const token = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
    return { value: JSON.parse(await readFile(outputPath, "utf8")), usage: {
      inputTokens: token(rawUsage?.input_tokens), outputTokens: token(rawUsage?.output_tokens), cachedInputTokens: token(rawUsage?.cached_input_tokens),
    } };
  } catch {
    lastFailureAt = Date.now();
    throw new Error("Codex 调用未完成，请检查本机登录、网络或额度后重试");
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function runCodexJson(prompt: string, schema: unknown) {
  return (await runCodexJsonWithUsage(prompt, schema)).value;
}
