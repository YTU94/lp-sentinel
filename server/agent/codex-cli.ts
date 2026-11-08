import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const children = new Set<ReturnType<typeof execFile>>();
let lastFailureAt = 0;
export const codexBinary = () => process.env.LP_CODEX_BIN || "codex";
export const codexLastFailureAt = () => lastFailureAt;
export function stopCodexCalls() { for (const child of children) child.kill("SIGTERM"); }

export async function inspectCodexCli() {
  const [version, login] = await Promise.allSettled([
    execute(codexBinary(), ["--version"], { timeout: 2_000, maxBuffer: 16_384 }),
    execute(codexBinary(), ["login", "status"], { timeout: 2_000, maxBuffer: 16_384 }),
  ]);
  return { installed: version.status === "fulfilled", authenticated: login.status === "fulfilled", cliVersion: version.status === "fulfilled" ? version.value.stdout.trim().slice(0, 80) : undefined };
}

export async function runCodexJson(prompt: string, schema: unknown) {
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
    if (!events.some(event => event.type === "turn.completed") || events.some(event => event.type === "turn.failed" || event.type === "error" || event.item && ["command_execution", "mcp_tool_call", "web_search", "file_change"].includes(event.item.type))) throw new Error("Codex 工具边界校验失败");
    return JSON.parse(await readFile(outputPath, "utf8"));
  } catch {
    lastFailureAt = Date.now();
    throw new Error("Codex 调用未完成，请检查本机登录、网络或额度后重试");
  } finally { await rm(directory, { recursive: true, force: true }); }
}
