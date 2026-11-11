import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface DwsIdentity {
  authenticated: boolean;
  userId?: string;
  userName?: string;
  corpId?: string;
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
      ...(result.corp_id ? { corpId: String(result.corp_id) } : {}),
      corpName: String(result.corp_name ?? ""),
    };
  } catch (error) {
    return { authenticated: false, error: error instanceof Error ? error.message : "DWS 状态读取失败" };
  }
}

let cachedRecipient: { profile: string; openId: string; until: number } | undefined;

export async function getDwsRecipient() {
  const identity = await getDwsIdentity();
  if (!identity.authenticated || !identity.corpId || !identity.userId) throw new Error("钉钉未登录或未取得当前用户，请执行 dws auth login");
  const profile = `${identity.corpId}:${identity.userId}`;
  if (cachedRecipient?.profile === profile && cachedRecipient.until > Date.now()) return cachedRecipient;
  try {
    const self = JSON.parse((await execFileAsync("dws", ["contact", "user", "get-self", "--profile", profile, "--format", "json"], { timeout: 15_000 })).stdout);
    const entries = Array.isArray(self.result) ? self.result : [self.result];
    const matches = entries.map((entry: { orgEmployeeModel?: Record<string, unknown> }) => entry?.orgEmployeeModel)
      .filter((entry: Record<string, unknown> | undefined) => entry && String(entry.userId) === identity.userId && String(entry.corpId) === identity.corpId);
    if (self.success !== true || matches.length !== 1 || typeof matches[0].orgUserName !== "string") throw new Error();
    const search = JSON.parse((await execFileAsync("dws", ["aisearch", "person", "--profile", profile, "--query", matches[0].orgUserName, "--dimension", "name", "--format", "json"], { timeout: 20_000 })).stdout);
    if (search.success !== true || !Array.isArray(search.result)) throw new Error();
    const candidates = search.result.filter((entry: { userId?: unknown; openDingTalkId?: unknown; _searchEvidence?: { exactAliasContainsQuery?: boolean } }) =>
      String(entry.userId) === identity.userId && entry._searchEvidence?.exactAliasContainsQuery === true && typeof entry.openDingTalkId === "string" && entry.openDingTalkId.length > 0);
    if (candidates.length !== 1) throw new Error();
    cachedRecipient = { profile, openId: candidates[0].openDingTalkId, until: Date.now() + 60_000 };
    return cachedRecipient;
  } catch { throw new Error("无法核验当前钉钉用户的收件人，请检查通讯录权限后重试"); }
}
