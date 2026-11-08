import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DwsIdentity {
  authenticated: boolean;
  userId?: string;
  userName?: string;
  corpName?: string;
  error?: string;
}

export async function getDwsIdentity(): Promise<DwsIdentity> {
  try {
    const { stdout } = await execFileAsync("dws", ["auth", "status", "--format", "json"], { timeout: 10_000 });
    const result = JSON.parse(stdout) as Record<string, unknown>;
    return {
      authenticated: result.authenticated === true,
      userId: String(result.user_id ?? ""),
      userName: String(result.user_name ?? ""),
      corpName: String(result.corp_name ?? ""),
    };
  } catch (error) {
    return { authenticated: false, error: error instanceof Error ? error.message : "DWS 状态读取失败" };
  }
}
