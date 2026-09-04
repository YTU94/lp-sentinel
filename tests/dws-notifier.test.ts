import { describe, expect, it } from 'vitest';
import { buildDwsCommands } from '../server/services/dws-notifier.js';
import type { Position, Settings } from '../server/domain/types.js';

describe('buildDwsCommands', () => {
  it('always sends chat to self and only appends enabled DING channels', () => {
    const position = { name: 'WBNB / USDT', currentPrice: 500, source: { tokenId: '1' } } as Position;
    const settings = { notificationEnabled: true, dingEnabled: true, dingCallEnabled: false, dingRobotCode: 'robot', pollIntervalMs: 5000 } as Settings;
    const commands = buildDwsCommands(position, 'upper', settings, { userId: 'me', openDingTalkId: 'open-me' }, 'fixed-id');
    expect(commands).toHaveLength(2);
    expect(commands[0]).toContain('chat');
    expect(commands[0]).toContain('--user');
    expect(commands[1]).toContain('app');
    expect(commands.flat()).not.toContain('call');
  });
});
