import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function getDwsAuthStatus() {
  try {
    const { stdout } = await run('dws', ['auth', 'status', '--format', 'json'], { timeout: 8_000, maxBuffer: 256_000 });
    const payload = JSON.parse(stdout) as Record<string, unknown>;
    return { authenticated: Boolean(payload.authenticated ?? payload.loggedIn ?? payload.user), user: String(payload.user ?? payload.name ?? ''), checkedAt: new Date().toISOString() };
  } catch {
    return { authenticated: false, checkedAt: new Date().toISOString(), error: 'DWS 未登录或命令不可用' };
  }
}
