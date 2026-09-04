import { describe, expect, it, vi } from 'vitest';
import type { PublicClient } from 'viem';
import { createV3Reader } from '../server/services/v3-reader.js';

describe('createV3Reader', () => {
  it('pins every contract read to one block and records capture lag and block time', async () => {
    const token0 = '0x0000000000000000000000000000000000000010';
    const token1 = '0x0000000000000000000000000000000000000011';
    const pool = '0x0000000000000000000000000000000000000012';
    const blockNumbers = [100n, 102n];
    const readContract = vi.fn(async (request: { functionName: string; address: string; blockNumber?: bigint }) => {
      expect(request.blockNumber).toBe(100n);
      if (request.functionName === 'ownerOf') return '0x0000000000000000000000000000000000000003';
      if (request.functionName === 'positions') return [0n, '0x0000000000000000000000000000000000000000', token0, token1, 3000, -100, 100, 10n ** 18n, 0n, 0n, 0n, 0n];
      if (request.functionName === 'getPool') return pool;
      if (request.functionName === 'slot0') return [2n ** 96n, 0, 0, 0, 0, 0, true];
      if (request.functionName === 'tickSpacing') return 60;
      if (request.functionName === 'symbol') return request.address === token0 ? 'AAA' : 'BBB';
      if (request.functionName === 'decimals') return 18;
      if (request.functionName.startsWith('feeGrowthGlobal')) return 0n;
      if (request.functionName === 'ticks') return [0n, 0n, 0n, 0n, 0n, 0n, 0, true];
      throw new Error(`unexpected ${request.functionName}`);
    });
    const client = {
      getBlockNumber: vi.fn(async () => blockNumbers.shift()!),
      getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => { expect(blockNumber).toBe(100n); return { timestamp: 1_788_508_800n }; }),
      readContract,
    } as unknown as PublicClient;
    const read = createV3Reader({ sourceId: 'bsc-pancake-v3', chainId: 56, networkName: 'BNB Chain', protocol: 'PancakeSwap V3', rpcUrl: 'https://example.invalid', explorer: 'https://example.invalid', positionManager: '0x0000000000000000000000000000000000000001', factory: '0x0000000000000000000000000000000000000002' }, client);
    const result = await read('42');
    expect(result.snapshot.blockNumber).toBe('100');
    expect(result.snapshot.headBlockNumber).toBe('102');
    expect(result.snapshot.blockLag).toBe(2);
    expect(result.snapshot.blockTimestamp).toBe('2026-09-04T08:00:00.000Z');
    expect(readContract).toHaveBeenCalled();
  });
});
