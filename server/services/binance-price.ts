export async function fetchBinancePrice(symbol: string): Promise<number> {
  const path = `/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`;
  const endpoints = ["https://api.binance.com", "https://data-api.binance.vision"];
  let lastError = "Binance 行情请求失败";

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(`${endpoint}${path}`, { signal: AbortSignal.timeout(8_000) });
      if (!response.ok) {
        const body = await response.text();
        lastError = `Binance 行情请求失败 (${response.status}) ${body.slice(0, 120)}`;
        continue;
      }
      const payload = await response.json() as { price?: string };
      const price = Number(payload.price);
      if (Number.isFinite(price) && price > 0) return price;
      lastError = "Binance 返回了无效价格";
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Binance 行情请求失败";
    }
  }

  throw new Error(lastError);
}
