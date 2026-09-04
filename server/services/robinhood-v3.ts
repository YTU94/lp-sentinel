import { createV3Reader } from './v3-reader.js';

export const robinhoodConfig = {
  sourceId: 'robinhood-uniswap-v3' as const,
  chainId: 4663,
  networkName: 'Robinhood Chain',
  protocol: 'Uniswap V3',
  rpcUrl: process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com',
  explorer: 'https://robinhoodchain.blockscout.com',
  positionManager: '0x73991a25c818bf1f1128deaab1492d45638de0d3' as const,
  factory: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa' as const,
};

export const readRobinhoodPosition = createV3Reader(robinhoodConfig);
