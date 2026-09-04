import { describe, expect, it, vi } from 'vitest';
import { getDingTalkConfig, sendDingTalkAlert } from '../server/services/dingtalk-notifier.js';
import { notifyPosition } from '../server/services/dws-notifier.js';
import type { Position } from '../server/domain/types.js';

const position = {
  name: 'WBNB / USDT',
  currentPrice: 500,
  source: { tokenId: '42', networkName: 'BNB Chain' },
} as Position;

describe('DingTalk OpenAPI notifier', () => {
  it('requires every server-side credential and never exposes their values in status', () => {
    const result = getDingTalkConfig({
      DINGTALK_APP_KEY: 'ding-secret-key',
      DINGTALK_APP_SECRET: 'super-secret',
      DINGTALK_ROBOT_CODE: 'robot-secret',
    });

    expect(result.config).toBeNull();
    expect(result.missing).toEqual(['DINGTALK_USER_IDS']);
    expect(JSON.stringify(result)).not.toContain('super-secret');
    expect(JSON.stringify(result)).not.toContain('robot-secret');
  });

  it('gets an app token and sends a text alert to configured user IDs', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'token-value', expireIn: 7200 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ processQueryKey: 'process-1', invalidStaffIdList: [], flowControlledStaffIdList: [] }), { status: 200 }));
    const { config } = getDingTalkConfig({
      DINGTALK_APP_KEY: 'ding-app',
      DINGTALK_APP_SECRET: 'app-secret',
      DINGTALK_ROBOT_CODE: 'robot-code',
      DINGTALK_USER_IDS: 'user-a, user-b',
    });

    await sendDingTalkAlert(position, 'upper', config!, fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][0]).toBe('https://api.dingtalk.com/v1.0/oauth2/accessToken');
    expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toEqual({ appKey: 'ding-app', appSecret: 'app-secret' });
    expect(fetcher.mock.calls[1][0]).toBe('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend');
    expect(fetcher.mock.calls[1][1].headers).toMatchObject({ 'x-acs-dingtalk-access-token': 'token-value' });
    const body = JSON.parse(String(fetcher.mock.calls[1][1].body));
    expect(body).toMatchObject({ robotCode: 'robot-code', userIds: ['user-a', 'user-b'], msgKey: 'sampleText' });
    expect(JSON.parse(body.msgParam).content).toContain('触及上限预警');
  });

  it('rejects invalid or throttled recipients instead of reporting a false success', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'token-value', expireIn: 7200 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ processQueryKey: 'process-1', invalidStaffIdList: ['bad-user'], flowControlledStaffIdList: [] }), { status: 200 }));
    const { config } = getDingTalkConfig({
      DINGTALK_APP_KEY: 'ding-app-2',
      DINGTALK_APP_SECRET: 'app-secret',
      DINGTALK_ROBOT_CODE: 'robot-code',
      DINGTALK_USER_IDS: 'bad-user',
    });

    await expect(sendDingTalkAlert(position, 'lower', config!, fetcher)).rejects.toThrow('接收人无效');
  });

  it('routes Vercel notifications through OpenAPI instead of the local DWS executable', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'cloud-token', expireIn: 7200 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ processQueryKey: 'process-2', invalidStaffIdList: [], flowControlledStaffIdList: [] }), { status: 200 }));

    await notifyPosition(position, 'upper', {
      pollIntervalMs: 5_000,
      notificationEnabled: true,
      dingEnabled: false,
      dingCallEnabled: false,
      dingRobotCode: '',
    }, {
      env: {
        VERCEL: '1',
        DINGTALK_APP_KEY: 'ding-app-router-test',
        DINGTALK_APP_SECRET: 'app-secret',
        DINGTALK_ROBOT_CODE: 'robot-code',
        DINGTALK_USER_IDS: 'user-a',
      },
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
