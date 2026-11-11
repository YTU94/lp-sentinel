import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, isAbsolute } from "node:path";
import { PortfolioWatch } from "./agent/portfolio-watch.js";
import { JsonStore } from "./store.js";
import { getDwsRecipient } from "./services/dws-auth.js";

const stateFile = process.env.LP_SENTINEL_DATA_FILE;
if (!stateFile || !isAbsolute(stateFile)) throw new Error("后台监控需要指定持久化的绝对路径 LP_SENTINEL_DATA_FILE");
if (process.env.VERCEL_REGION) throw new Error("Vercel Daemon 不支持持久本地文件，需先接入云端持久存储");
await access(stateFile, constants.R_OK | constants.W_OK);
await access(dirname(stateFile), constants.W_OK);
const lock = spawn("flock", ["-n", `${stateFile}.lock`, process.execPath, "-e", "process.stdout.write('ready'); process.stdin.resume()"], { stdio: ["pipe", "pipe", "pipe"] });
await new Promise<void>((resolve, reject) => {
  lock.once("error", () => reject(new Error("后台监控需要 Linux flock 命令")));
  lock.once("exit", () => reject(new Error("监控状态文件已由另一个后台进程使用")));
  lock.stdout.once("data", () => resolve());
});
let lockLost = false;
lock.once("exit", () => { lockLost = true; });
const store = new JsonStore(stateFile);
await store.load();
if (!store.snapshot.portfolioWatch?.enabled) throw new Error("持久化文件中没有已启用的地址监控");
await getDwsRecipient();
if (lockLost) throw new Error("后台监控锁已失效");
const watch = new PortfolioWatch(store, false);
let stopping = false;
lock.once("exit", () => {
  if (!stopping) { watch.stop(); console.error("后台监控锁已失效，进程停止"); process.exit(1); }
});
await watch.start();
console.log("LP 自动监控后台进程已启动");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { stopping = true; watch.stop(); lock.stdin.end(); process.exit(0); });
}
