import type { AlertBoundary, Position } from '../domain/types.js';

const TOKEN_URL = 'https://api.dingtalk.com/v1.0/oauth2/accessToken';
const OTO_MESSAGE_URL = 'https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend';

export interface DingTalkConfig {
  appKey: string;
  appSecret: string;
  robotCode: string;
  userIds: string[];
}

interface TokenEntry { value: string; expiresAt: number }
const tokenCache = new Map<string, TokenEntry>();

export function getDingTalkConfig(env: Record<string, string | undefined> = process.env): { config: DingTalkConfig | null; missing: string[] } {
  const names = ['DINGTALK_APP_KEY', 'DINGTALK_APP_SECRET', 'DINGTALK_ROBOT_CODE', 'DINGTALK_USER_IDS'] as const;
  const missing = names.filter((name) => !env[name]?.trim());
  if (missing.length > 0) return { config: null, missing };
  const userIds = [...new Set(env.DINGTALK_USER_IDS!.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean))].slice(0, 20);
  if (userIds.length === 0) return { config: null, missing: ['DINGTALK_USER_IDS'] };
  return {
    config: {
      appKey: env.DINGTALK_APP_KEY!.trim(),
      appSecret: env.DINGTALK_APP_SECRET!.trim(),
      robotCode: env.DINGTALK_ROBOT_CODE!.trim(),
      userIds,
    },
    missing: [],
  };
}

export function buildAlertContent(position: Position, boundary: AlertBoundary): string {
  const line = boundary === 'lower' ? '下限' : '上限';
  const network = position.source.networkName ? ` · ${position.source.networkName}` : '';
  return `[LP Sentinel] ${position.name} #${position.source.tokenId}${network} 触及${line}预警：${position.currentPrice?.toPrecision(7)}`;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

async function requireSuccess(response: Response, stage: string): Promise<Record<string, unknown>> {
  const body = await readJson(response);
  if (response.ok) return body;
  const code = typeof body.code === 'string' ? body.code : String(response.status);
  const message = typeof body.message === 'string' ? `：${body.message}` : '';
  throw new Error(`钉钉${stage}失败 (${code})${message}`);
}

async function getAccessToken(config: DingTalkConfig, fetcher: typeof fetch): Promise<string> {
  const cached = tokenCache.get(config.appKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;
  const response = await fetcher(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ appKey: config.appKey, appSecret: config.appSecret }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await requireSuccess(response, '鉴权');
  const accessToken = typeof body.accessToken === 'string' ? body.accessToken : '';
  if (!accessToken) throw new Error('钉钉鉴权响应缺少 accessToken');
  const expireIn = typeof body.expireIn === 'number' ? body.expireIn : 7200;
  tokenCache.set(config.appKey, { value: accessToken, expiresAt: Date.now() + Math.max(60, expireIn) * 1000 });
  return accessToken;
}

export async function sendDingTalkAlert(position: Position, boundary: AlertBoundary, config: DingTalkConfig, fetcher: typeof fetch = fetch): Promise<void> {
  const accessToken = await getAccessToken(config, fetcher);
  const response = await fetcher(OTO_MESSAGE_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-acs-dingtalk-access-token': accessToken,
    },
    body: JSON.stringify({
      robotCode: config.robotCode,
      userIds: config.userIds,
      msgKey: 'sampleText',
      msgParam: JSON.stringify({ content: buildAlertContent(position, boundary) }),
    }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await requireSuccess(response, '消息发送');
  const invalid = Array.isArray(body.invalidStaffIdList) ? body.invalidStaffIdList.length : 0;
  const throttled = Array.isArray(body.flowControlledStaffIdList) ? body.flowControlledStaffIdList.length : 0;
  if (invalid > 0) throw new Error(`钉钉消息发送失败：${invalid} 个接收人无效`);
  if (throttled > 0) throw new Error(`钉钉消息发送受限：${throttled} 个接收人被限流`);
  if (typeof body.processQueryKey !== 'string' || !body.processQueryKey) throw new Error('钉钉消息发送响应缺少 processQueryKey');
}
