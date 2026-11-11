import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface NotificationInput {
  userId: string;
  message: string;
  dingEnabled: boolean;
  dingCallEnabled?: boolean;
  robotCode?: string;
}

export function buildNotificationCommands(input: NotificationInput): string[][] {
  const robotCode = input.robotCode?.trim();
  const commands = [[
    "chat", "message", "send",
    "--user", input.userId,
    "--title", "LP Sentinel 价格预警",
    "--text", input.message,
    "--format", "json",
  ]];

  if (input.dingEnabled || input.dingCallEnabled) {
    if (!robotCode) {
      throw new Error("DING 机器人编码未配置");
    }
  }

  if (input.dingEnabled) {
    commands.push([
      "ding", "message", "send",
      "--robot-code", robotCode!,
      "--type", "app",
      "--users", input.userId,
      "--content", input.message,
      "--format", "json",
    ]);
  }

  if (input.dingCallEnabled) {
    commands.push([
      "ding", "message", "send",
      "--robot-code", robotCode!,
      "--type", "call",
      "--users", input.userId,
      "--content", input.message,
      "--format", "json",
    ]);
  }

  return commands;
}

function runDws(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("dws", args, { shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `DWS 执行失败，退出码 ${code}`));
    });
  });
}

export interface NotificationResult {
  chatSent: true;
  dingSent: boolean;
  callSent: boolean;
  dingError?: string;
}

export async function sendNotification(input: NotificationInput): Promise<NotificationResult> {
  const commands = buildNotificationCommands(input);
  await runDws(commands[0]);
  let dingSent = false;
  let callSent = false;
  const errors: string[] = [];
  for (const command of commands.slice(1)) {
    const type = command[command.indexOf("--type") + 1];
    try {
      await runDws(command);
      if (type === "call") callSent = true;
      else dingSent = true;
    } catch (error) {
      errors.push(`${type === "call" ? "电话 DING" : "应用内 DING"}：${error instanceof Error ? error.message : "发送失败"}`);
    }
  }
  return { chatSent: true, dingSent, callSent, dingError: errors.length ? errors.join("；") : undefined };
}

const executeDws = promisify(execFile);

function responseObjects(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(responseObjects);
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  return [object, ...responseObjects(object.data), ...responseObjects(object.result)];
}

export async function sendPortfolioNotification(profile: string, openId: string, message: string, eventId: string, taskId?: string) {
  const args = taskId
    ? ["chat", "+messages-query-send-status", "--open-task-id", taskId]
    : ["chat", "message", "send", "--open-dingtalk-id", openId, "--title", "LP 出区间提醒", "--content", message, "--idempotency-key", eventId];
  let result: Record<string, unknown>;
  try {
    const { stdout } = await executeDws("dws", [...args, "--profile", profile, "--timeout", "15", "--format", "json"], { timeout: 20_000, maxBuffer: 128_000 });
    result = JSON.parse(stdout) as Record<string, unknown>;
  } catch { throw new Error(taskId ? "钉钉投递状态查询失败，请检查登录和网络" : "钉钉发送结果未知，请检查登录、权限和网络"); }
  const objects = responseObjects(result);
  if (objects.some(item => item.ok === false || item.success === false || item.outcome === "failure")) throw new Error("钉钉未接受消息，请检查登录和消息权限");
  const status = objects.map(item => item.sendStatus).find(value => typeof value === "string");
  if (status === "SUCCESS") return { state: "sent" as const, taskId };
  if (status && ["FAIL", "FAILED", "FAILURE"].includes(String(status))) throw new Error("钉钉消息投递失败，请检查消息权限");
  const returnedTask = objects.map(item => item.openTaskId).find(value => typeof value === "string" && value.length > 0) as string | undefined;
  return { state: returnedTask || taskId ? "pending" as const : "uncertain" as const, taskId: returnedTask || taskId };
}
