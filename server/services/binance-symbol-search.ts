export async function searchBinanceSymbols(query: string) {
  if (!query.trim()) return [];
  const response = await fetch('https://api.binance.com/api/v3/exchangeInfo', { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error('Binance 行情暂不可用');
  const data = await response.json() as { symbols: Array<{ symbol: string; baseAsset: string; quoteAsset: string; status: string }> };
  const needle = query.toUpperCase();
  return data.symbols.filter((item) => item.status === 'TRADING' && (item.symbol.includes(needle) || item.baseAsset.includes(needle))).slice(0, 20);
}
