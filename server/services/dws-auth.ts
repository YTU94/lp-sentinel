import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export type DwsRunner = (file: string, args: string[], options: { timeout: number; maxBuffer: number }) => Promise<{ stdout: string | Buffer }>;
const run = promisify(execFile) as unknown as DwsRunner;

export interface DwsAuthStatus {
  authenticated: boolean;
  user?: string;
  checkedAt: string;
  error?: string;
}

function findValue(value: unknown, keys: string[]): unknown {
  if (!value || typeof value !== 'object') return undefined;
  for (const key of keys) {
    const direct = (value as Record<string, unknown>)[key];
    if (direct !== undefined) return direct;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = findValue(child, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function parseDwsAuthStatus(payload: unknown, checkedAt = new Date().toISOString()): DwsAuthStatus {
  const authenticated = findValue(payload, ['authenticated', 'loggedIn', 'logged_in']) === true;
  const tokenValid = findValue(payload, ['token_valid', 'tokenValid']);
  if (!authenticated) return { authenticated: false, checkedAt, error: 'DWS CLI 未登录，请执行 dws auth login' };
  if (tokenValid === false) return { authenticated: false, checkedAt, error: 'DWS 登录已过期，请重新执行 dws auth login' };
  const userValue = findValue(payload, ['user_name', 'userName', 'name']);
  const user = typeof userValue === 'string' && userValue.trim() ? userValue.trim() : undefined;
  return { authenticated: true, ...(user ? { user } : {}), checkedAt };
}

export async function getDwsAuthStatus(runner: DwsRunner = run): Promise<DwsAuthStatus> {
  try {
    const { stdout } = await runner('dws', ['auth', 'status', '--format', 'json'], { timeout: 8_000, maxBuffer: 256_000 });
    return parseDwsAuthStatus(JSON.parse(String(stdout)));
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return {
      authenticated: false,
      checkedAt: new Date().toISOString(),
      error: missing ? '未检测到 DWS CLI，请先安装并执行 dws auth login' : 'DWS CLI 未登录，请执行 dws auth login',
    };
  }
}
