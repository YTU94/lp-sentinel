import { describe, expect, it } from 'vitest';
import { defaultBscRpcUrls } from '../server/services/pancake-v3.js';

describe('BSC RPC priority', () => {
  it('uses the responsive public endpoint before the slow fallback', () => {
    expect(defaultBscRpcUrls).toEqual([
      'https://bsc-rpc.publicnode.com',
      'https://bsc-dataseed.binance.org',
    ]);
  });
});
