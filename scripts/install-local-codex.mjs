import { execFile } from "node:child_process";
import { lstat, mkdtemp, mkdir, rename, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

if (process.platform !== "darwin") throw new Error("此启动器适用于 macOS，其他系统可运行 npm run codex:bridge");
const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(homedir(), "Applications/LP Sentinel Codex.app");
const bundleId = "dev.lpsentinel.codex-bridge";
const temporary = await mkdtemp(join(tmpdir(), "lp-codex-launcher-"));
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
try {
  const exists = await lstat(target).then(() => true).catch(error => { if (error.code === "ENOENT") return false; throw error; });
  if (exists) {
    const { stdout } = await execute("/usr/bin/plutil", ["-extract", "CFBundleIdentifier", "raw", join(target, "Contents/Info.plist")]);
    if (stdout.trim() !== bundleId) throw new Error("启动器名称已被其他应用占用");
  }
  const { stdout } = await execute("/usr/bin/which", ["codex"]);
  const command = `LP_CODEX_BIN=${quote(stdout.trim())} ${quote(process.execPath)} ${quote(join(root, "scripts/start-local-codex.mjs"))} >/dev/null 2>&1 </dev/null &`;
  const source = `on run\n  launchBridge()\nend run\non open location ignoredURL\n  launchBridge()\nend open location\non launchBridge()\n  do shell script ${JSON.stringify(command)}\nend launchBridge`;
  const built = join(temporary, "LP Sentinel Codex.app");
  await execute("/usr/bin/osacompile", ["-o", built, "-e", source]);
  const plist = join(built, "Contents/Info.plist");
  await execute("/usr/bin/plutil", ["-replace", "CFBundleIdentifier", "-string", bundleId, plist]);
  await execute("/usr/bin/plutil", ["-insert", "LSUIElement", "-bool", "true", plist]);
  await execute("/usr/bin/plutil", ["-insert", "CFBundleURLTypes", "-json", JSON.stringify([{ CFBundleURLName: bundleId, CFBundleURLSchemes: ["lp-sentinel"] }]), plist]);
  await execute("/usr/bin/codesign", ["--force", "--sign", "-", built]);
  await mkdir(dirname(target), { recursive: true });
  await rm(target, { recursive: true, force: true });
  await rename(built, target);
  await execute("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", ["-f", target]);
  console.log(`已安装本机启动器 ${target}`);
} finally { await rm(temporary, { recursive: true, force: true }); }
await import("./start-local-codex.mjs");
