import { describe, expect, it } from 'vitest';
import { getDwsAuthStatus, parseDwsAuthStatus } from '../server/services/dws-auth.js';

describe('DWS CLI authentication', () => {
  it('requires both an authenticated profile and a valid token', () => {
    expect(parseDwsAuthStatus({ authenticated: true, token_valid: true, user_name: 'Alice' })).toMatchObject({
      authenticated: true,
      user: 'Alice',
    });
    expect(parseDwsAuthStatus({ authenticated: true, token_valid: false, user_name: 'Alice' })).toMatchObject({
      authenticated: false,
      error: 'DWS 登录已过期，请重新执行 dws auth login',
    });
  });

  it('reports a missing executable without exposing process details', async () => {
    const run = async () => { throw Object.assign(new Error('secret path'), { code: 'ENOENT' }); };
    const status = await getDwsAuthStatus(run);
    expect(status).toMatchObject({
      authenticated: false,
      error: '未检测到 DWS CLI，请先安装并执行 dws auth login',
    });
    expect(JSON.stringify(status)).not.toContain('secret path');
  });
});
