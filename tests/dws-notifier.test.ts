import { describe, expect, it } from 'vitest';
import { buildDwsCommands } from '../server/services/dws-notifier.js';
import type { Position, Settings } from '../server/domain/types.js';

describe('buildDwsCommands', () => {
  it('uses the authenticated DWS identity for chat and personal DING channels', () => {
    const position = { name: 'WBNB / USDT', currentPrice: 500, source: { tokenId: '1' } } as Position;
    const settings = { notificationEnabled: true, dingEnabled: true, dingCallEnabled: false, pollIntervalMs: 5000 } as Settings;
    const commands = buildDwsCommands(position, 'upper', settings, { userId: 'me', openDingTalkId: 'open-me' }, 'fixed-id');
    expect(commands).toHaveLength(2);
    expect(commands[0].slice(0, 3)).toEqual(['chat', 'message', 'send']);
    expect(commands[0]).toContain('--user');
    expect(commands[0]).not.toContain('--content');
    expect(commands[1].slice(0, 4)).toEqual(['ding', 'message', 'send-personal', '--users']);
    expect(commands[1]).toContain('open-me');
    expect(commands[1]).toContain('app');
    expect(commands.flat()).not.toContain('--robot-code');
    expect(commands.flat()).not.toContain('call');
  });

  it('fails before sending when a requested personal DING has no openDingTalkId', () => {
    const position = { name: 'WBNB / USDT', currentPrice: 500, source: { tokenId: '1' } } as Position;
    const settings = { notificationEnabled: true, dingEnabled: true, dingCallEnabled: true, pollIntervalMs: 5000 } as Settings;
    expect(() => buildDwsCommands(position, 'lower', settings, { userId: 'me', openDingTalkId: '' }, 'fixed-id')).toThrow('openDingTalkId');
  });
});
