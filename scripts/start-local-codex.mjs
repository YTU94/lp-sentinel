import { spawn, execFile } from "node:child_process";
import { open, readFile } from "node:fs/promises";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { createServer } from "node:net";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const entry = resolve(root, "server/local-codex-bridge.ts");
const pidPath = resolve(root, "data/local-codex.pid");
process.env.PATH = `${dirname(process.execPath)}${delimiter}${process.env.PATH || "/usr/bin:/bin"}`;
async function status() {
  try {
    const response = await fetch("http://127.0.0.1:4318/api/local/status", { signal: AbortSignal.timeout(3_000) });
    const body = await response.json();
    return response.ok && body.service === "lp-sentinel-codex" && body.version === 1 ? body : undefined;
  } catch { return undefined; }
}
let current = await status();
if (!current) {
  try {
    const previous = JSON.parse(await readFile(pidPath, "utf8"));
    if (Number.isSafeInteger(previous.pid) && previous.pid > 1 && previous.script === entry) {
      const { stdout } = await promisify(execFile)("/bin/ps", ["-p", String(previous.pid), "-o", "command="]);
      if (stdout.includes(entry)) { process.kill(previous.pid, "SIGTERM"); await delay(500); }
    }
  } catch { /* A stopped service can leave a stale PID file. */ }
  await new Promise((accept, reject) => {
    const probe = createServer();
    probe.once("error", () => reject(new Error("4318 端口被其他程序占用，请释放该端口后修复")));
    probe.listen(4318, "127.0.0.1", () => probe.close(accept));
  });
  const { mkdir } = await import("node:fs/promises");
  await mkdir(resolve(root, "data"), { recursive: true });
  const log = await open(resolve(root, "data/local-codex.log"), "a", 0o600);
  const child = spawn(process.execPath, ["--import", "tsx", entry], { cwd: root, detached: true, stdio: ["ignore", log.fd, log.fd], env: { ...process.env, LP_PORTFOLIO_AI_PROVIDER: "codex" } });
  child.unref();
  await log.close();
}
for (let attempt = 0; attempt < 100; attempt++) {
  current = await status();
  if (current) break;
  await delay(1_000);
}
if (!current) throw new Error("本机 API 尚未完成启动，请查看 data/local-codex.log");
if (current.phase !== "ready") {
  const response = await fetch("http://127.0.0.1:4318/api/local/repair", { method: "POST", headers: { "Content-Type": "application/json", "X-LP-Bridge-Token": current.sessionToken }, body: "{}", signal: AbortSignal.timeout(100_000) });
  current = await response.json();
}
console.log(current.phase === "ready" ? "本机 Codex API ready · http://127.0.0.1:4318" : current.message);
if (current.phase !== "ready") process.exitCode = 1;
