import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import type { AlertBoundary, Position, Settings } from '../domain/types.js';
import type { DwsRunner } from './dws-auth.js';

const run = promisify(execFile) as unknown as DwsRunner;

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

async function getSelfIdentity(runner: DwsRunner): Promise<DwsIdentity> {
  const { stdout } = await runner('dws', ['contact', 'user', 'get-self', '--format', 'json'], { timeout: 10_000, maxBuffer: 256_000 });
  const payload = JSON.parse(String(stdout)) as unknown;
  const userId = findString(payload, ['userId', 'userid', 'user_id']);
  const openDingTalkId = findString(payload, ['openDingTalkId', 'openDingtalkId', 'open_dingtalk_id']);
  if (!userId) throw new Error('DWS 当前身份缺少 userId');
  return { userId, openDingTalkId };
}

export function buildAlertContent(position: Position, boundary: AlertBoundary): string {
  const line = boundary === 'lower' ? '下限' : '上限';
  const network = position.source.networkName ? ` · ${position.source.networkName}` : '';
  return `[LP Sentinel] ${position.name} #${position.source.tokenId}${network} 触及${line}预警：${position.currentPrice?.toPrecision(7)}`;
}

export function buildDwsCommands(position: Position, boundary: AlertBoundary, settings: Settings, identity: DwsIdentity, idempotencyKey = randomUUID()): string[][] {
  if (!settings.notificationEnabled) return [];
  if ((settings.dingEnabled || settings.dingCallEnabled) && !identity.openDingTalkId) throw new Error('DWS 当前身份缺少 openDingTalkId，无法发送个人 DING');
  const content = buildAlertContent(position, boundary);
  const commands = [['chat', 'message', 'send', '--user', identity.userId, content, '--idempotency-key', idempotencyKey, '--format', 'json']];
  if (settings.dingEnabled && identity.openDingTalkId) commands.push(['ding', 'message', 'send-personal', '--users', identity.openDingTalkId, '--content', content, '--type', 'app', '--uuid', `${idempotencyKey}-app`, '--format', 'json']);
  if (settings.dingCallEnabled && identity.openDingTalkId) commands.push(['ding', 'message', 'send-personal', '--users', identity.openDingTalkId, '--content', content, '--type', 'call', '--uuid', `${idempotencyKey}-call`, '--format', 'json']);
  return commands;
}

async function runCommands(commands: string[][], runner: DwsRunner): Promise<void> {
  for (const args of commands) await runner('dws', args, { timeout: 15_000, maxBuffer: 256_000 });
}

export async function sendDwsTestNotification(runner: DwsRunner = run): Promise<void> {
  const identity = await getSelfIdentity(runner);
  const content = `[LP Sentinel] DWS CLI 通知测试成功 · ${new Date().toISOString()}`;
  await runCommands([['chat', 'message', 'send', '--user', identity.userId, content, '--idempotency-key', randomUUID(), '--format', 'json']], runner);
}

export async function notifyPosition(position: Position, boundary: AlertBoundary, settings: Settings, options: { runner?: DwsRunner } = {}) {
  if (!settings.notificationEnabled) return;
  const runner = options.runner || run;
  const identity = await getSelfIdentity(runner);
  await runCommands(buildDwsCommands(position, boundary, settings, identity), runner);
}
