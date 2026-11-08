import { spawn } from "node:child_process";

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
