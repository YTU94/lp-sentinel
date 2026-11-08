import type { LiveLpPosition } from "./live-lp.js";
import type { OnchainPositionSnapshot, PositionInput } from "./position.js";

type ImportableLiveLp = Pick<LiveLpPosition,
  "sourceId" | "tokenId" | "chainId" | "protocol" | "positionManager" | "pool" | "owner" |
  "symbol0" | "symbol1" | "fee" | "lowerPrice" | "currentPrice" | "upperPrice" |
  "positionValueQuote"
> & Partial<Pick<LiveLpPosition,
  "amount0" | "amount1" | "formattedOwed0" | "formattedOwed1" | "blockNumber" | "updatedAt"
>> & { alertRecommendation?: Pick<NonNullable<LiveLpPosition["alertRecommendation"]>, "alertLower" | "alertUpper"> };

type SnapshotInput = Pick<LiveLpPosition,
  "currentPrice" | "amount0" | "amount1" | "positionValueQuote" |
  "formattedOwed0" | "formattedOwed1" | "blockNumber" | "updatedAt"
> & Partial<Pick<LiveLpPosition,
  "networkName" | "protocol" | "pool" | "fee" | "liquidity" |
  "tickLower" | "currentTick" | "tickUpper" | "status" | "lifecycle" | "lifecycleUnavailableReason"
>>;

function amountAtPrice(symbol: string, amount: number, currentPrice: number, isBase: boolean) {
  return { symbol, amount, valueQuote: amount * (isBase ? currentPrice : 1) };
}

export function chainSnapshotFromLiveLp(position: SnapshotInput, symbol0: string, symbol1: string): OnchainPositionSnapshot {
  const collectableAmount0 = Number(position.formattedOwed0);
  const collectableAmount1 = Number(position.formattedOwed1);
  const feeAmount0 = position.lifecycle?.unclaimedFees0 ?? collectableAmount0;
  const feeAmount1 = position.lifecycle?.unclaimedFees1 ?? collectableAmount1;
  const feeValue0 = feeAmount0 * position.currentPrice;
  const feeValue1 = feeAmount1;
  const unclaimedFeesValueQuote = feeValue0 + feeValue1;
  const snapshot: OnchainPositionSnapshot = {
    assets: [
      { symbol: symbol0, amount: position.amount0, valueQuote: position.amount0 * position.currentPrice },
      { symbol: symbol1, amount: position.amount1, valueQuote: position.amount1 },
    ],
    unclaimedFees: [
      { symbol: symbol0, amount: feeAmount0, valueQuote: feeValue0 },
      { symbol: symbol1, amount: feeAmount1, valueQuote: feeValue1 },
    ],
    principalValueQuote: position.positionValueQuote,
    unclaimedFeesValueQuote,
    totalValueQuote: position.positionValueQuote + collectableAmount0 * position.currentPrice + collectableAmount1,
    blockNumber: position.blockNumber,
    updatedAt: position.updatedAt,
    analyticsUnavailableReason: position.lifecycleUnavailableReason,
  };
  if (position.networkName && position.protocol && position.pool && position.fee !== undefined && position.liquidity !== undefined &&
    position.tickLower !== undefined && position.currentTick !== undefined && position.tickUpper !== undefined && position.status) {
    snapshot.market = {
      networkName: position.networkName,
      protocol: position.protocol,
      pool: position.pool,
      feeTierPercent: position.fee / 10_000,
      liquidity: position.liquidity,
      tickLower: position.tickLower,
      currentTick: position.currentTick,
      tickUpper: position.tickUpper,
      status: position.status,
    };
  }
  if (position.lifecycle) {
    const lifecycle = position.lifecycle;
    const deposited = [
      amountAtPrice(symbol0, lifecycle.deposited0, position.currentPrice, true),
      amountAtPrice(symbol1, lifecycle.deposited1, position.currentPrice, false),
    ] as const;
    const withdrawn = [
      amountAtPrice(symbol0, lifecycle.withdrawn0, position.currentPrice, true),
      amountAtPrice(symbol1, lifecycle.withdrawn1, position.currentPrice, false),
    ] as const;
    const collected = [
      amountAtPrice(symbol0, lifecycle.collected0, position.currentPrice, true),
      amountAtPrice(symbol1, lifecycle.collected1, position.currentPrice, false),
    ] as const;
    const lifetimeFees = [
      amountAtPrice(symbol0, lifecycle.totalFees0, position.currentPrice, true),
      amountAtPrice(symbol1, lifecycle.totalFees1, position.currentPrice, false),
    ] as const;
    const depositedValueQuote = lifecycle.depositedValueQuote;
    const withdrawnValueQuote = lifecycle.withdrawnValueQuote;
    const collectedValueQuote = lifecycle.collectedValueQuote;
    const currentUnclaimedFeesValueQuote = feeValue0 + feeValue1;
    const lifetimeFeesValueQuote = lifecycle.claimedFeesValueQuote + currentUnclaimedFeesValueQuote;
    const holdValueQuote = depositedValueQuote;
    const poolPnlQuote = position.positionValueQuote + collectedValueQuote - depositedValueQuote;
    const divergencePnlQuote = poolPnlQuote - lifetimeFeesValueQuote;
    const ageDays = lifecycle.ageSeconds / 86_400;
    snapshot.analytics = {
      createdAt: lifecycle.createdAt,
      ageSeconds: lifecycle.ageSeconds,
      eventCount: lifecycle.eventCount,
      deposited: [...deposited],
      withdrawn: [...withdrawn],
      collected: [...collected],
      lifetimeFees: [...lifetimeFees],
      depositedValueQuote,
      withdrawnValueQuote,
      collectedValueQuote,
      lifetimeFeesValueQuote,
      averageDailyFeesQuote: ageDays > 0 ? lifetimeFeesValueQuote / ageDays : 0,
      holdValueQuote,
      divergencePnlQuote,
      poolPnlQuote,
      roiPercent: depositedValueQuote > 0 ? poolPnlQuote / depositedValueQuote * 100 : undefined,
      lifetimeFeeAprPercent: depositedValueQuote > 0 && lifecycle.ageSeconds > 0
        ? lifetimeFeesValueQuote / depositedValueQuote * (31_536_000 / lifecycle.ageSeconds) * 100
        : undefined,
      pendingRemovedValueQuote: lifecycle.pendingRemoved0 * position.currentPrice + lifecycle.pendingRemoved1,
      gasSpentNative: lifecycle.gasSpentNative,
      nativeSymbol: lifecycle.nativeSymbol,
    };
  }
  return snapshot;
}

export function positionInputFromLiveLp(position: ImportableLiveLp): PositionInput {
  if (!position.alertRecommendation) throw new Error("该 LP 区间过窄，无法自动生成预警线；可通过地址查询查看持仓并分析。");
  const referencePrice = Math.min(position.upperPrice, Math.max(position.lowerPrice, position.currentPrice));
  const hasSnapshot = position.amount0 !== undefined && position.amount1 !== undefined &&
    position.formattedOwed0 !== undefined && position.formattedOwed1 !== undefined &&
    position.blockNumber !== undefined && position.updatedAt !== undefined;
  const source = { type: position.sourceId, chainId: position.chainId } as import("./position.js").LivePositionSource;
  return {
    name: `${position.symbol0} / ${position.symbol1} · NFT #${position.tokenId}`,
    symbol: `${position.symbol0}${position.symbol1}`,
    baseAsset: position.symbol0,
    quoteAsset: position.symbol1,
    lowerPrice: position.lowerPrice,
    upperPrice: position.upperPrice,
    entryPrice: referencePrice,
    capitalQuote: position.positionValueQuote > 0 ? position.positionValueQuote : 0.000001,
    feeTier: position.fee / 1_000_000,
    alertLower: position.alertRecommendation.alertLower,
    alertUpper: position.alertRecommendation.alertUpper,
    source: {
      ...source,
      tokenId: position.tokenId,
      positionManager: position.positionManager,
      pool: position.pool,
      owner: position.owner,
    },
    chainSnapshot: hasSnapshot ? chainSnapshotFromLiveLp(position as SnapshotInput, position.symbol0, position.symbol1) : undefined,
  };
}
