import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { AlertBoundary, Position, Settings } from '../domain/types.js';

const run = promisify(execFile);

interface DwsIdentity { userId: string; openDingTalkId: string }

function findString(value: unknown, keys: string[]): string {
  if (!value || typeof value !== 'object') return '';
  for (const key of keys) {
    const direct = (value as Record<string, unknown>)[key];
    if (typeof direct === 'string' && direct) return direct;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = findString(child, keys);
    if (found) return found;
  }
  return '';
}

async function getSelfIdentity(): Promise<DwsIdentity> {
  const { stdout } = await run('dws', ['contact', 'user', 'get-self', '--format', 'json'], { timeout: 10_000, maxBuffer: 256_000 });
  const payload = JSON.parse(stdout) as unknown;
  const userId = findString(payload, ['userId', 'userid', 'user_id']);
  const openDingTalkId = findString(payload, ['openDingTalkId', 'openDingtalkId', 'open_dingtalk_id']);
  if (!userId) throw new Error('DWS 当前身份缺少 userId');
  return { userId, openDingTalkId };
}

export function buildDwsCommands(position: Position, boundary: AlertBoundary, settings: Settings, identity: DwsIdentity, idempotencyKey = randomUUID()): string[][] {
  if (!settings.notificationEnabled) return [];
  const line = boundary === 'lower' ? '下限' : '上限';
  const content = `[LP Sentinel] ${position.name} #${position.source.tokenId} 触及${line}预警：${position.currentPrice?.toPrecision(7)}`;
  const commands = [['chat', 'message', 'send', '--user', identity.userId, '--content', content, '--idempotency-key', idempotencyKey, '--format', 'json', '--yes']];
  if (settings.dingEnabled && settings.dingRobotCode) commands.push(['ding', 'message', 'send', '--robot-code', settings.dingRobotCode, '--users', identity.userId, '--content', content, '--type', 'app', '--format', 'json', '--yes']);
  if (settings.dingCallEnabled && settings.dingRobotCode) commands.push(['ding', 'message', 'send', '--robot-code', settings.dingRobotCode, '--users', identity.userId, '--content', content, '--type', 'call', '--format', 'json', '--yes']);
  return commands;
}

export async function notifyPosition(position: Position, boundary: AlertBoundary, settings: Settings) {
  if (!settings.notificationEnabled) return;
  const identity = await getSelfIdentity();
  for (const args of buildDwsCommands(position, boundary, settings, identity)) await run('dws', args, { timeout: 15_000, maxBuffer: 256_000 });
}
