export interface BinanceSymbolCandidate {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  price: number;
}

export async function searchBinanceSymbols(
  query: string,
  fetcher: typeof fetch = fetch,
): Promise<BinanceSymbolCandidate[]> {
  const normalized = query.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (normalized.length < 2) return [];

  const [exchangeResponse, priceResponse] = await Promise.all([
    fetcher("https://data-api.binance.vision/api/v3/exchangeInfo"),
    fetcher("https://data-api.binance.vision/api/v3/ticker/price"),
  ]);
  if (!exchangeResponse.ok || !priceResponse.ok) throw new Error("Binance 代币列表暂时不可用");

  const exchange = await exchangeResponse.json() as {
    symbols?: Array<{ symbol: string; baseAsset: string; quoteAsset: string; status: string; isSpotTradingAllowed?: boolean }>;
  };
  const prices = await priceResponse.json() as Array<{ symbol: string; price: string }>;
  const priceBySymbol = new Map(prices.map((item) => [item.symbol, Number(item.price)]));

  return (exchange.symbols ?? [])
    .filter((item) => item.status === "TRADING" && item.isSpotTradingAllowed !== false)
    .filter((item) => item.symbol.includes(normalized) || item.baseAsset.includes(normalized) || item.quoteAsset.includes(normalized))
    .map((item) => ({ ...item, price: priceBySymbol.get(item.symbol) ?? 0 }))
    .filter((item) => Number.isFinite(item.price) && item.price > 0)
    .sort((left, right) => {
      const score = (item: typeof left) =>
        (item.baseAsset === normalized ? 100 : 0) +
        (item.symbol.startsWith(normalized) ? 20 : 0) +
        (item.quoteAsset === "USDT" ? 10 : 0);
      return score(right) - score(left) || left.symbol.localeCompare(right.symbol);
    })
    .slice(0, 8)
    .map(({ symbol, baseAsset, quoteAsset, price }) => ({ symbol, baseAsset, quoteAsset, price }));
}
