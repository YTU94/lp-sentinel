export type PriceFreshness = { state: "fresh" | "delayed" | "stale"; label: string };

export function getPriceFreshness(updatedAt: string | undefined, now = Date.now()): PriceFreshness {
  if (!updatedAt) return { state: "stale", label: "等待首次更新" };
  const seconds = Math.max(0, Math.floor((now - new Date(updatedAt).getTime()) / 1_000));
  if (seconds <= 10) return { state: "fresh", label: seconds === 0 ? "刚刚更新" : `${seconds} 秒前更新` };
  if (seconds <= 30) return { state: "delayed", label: `行情延迟 · ${seconds} 秒前` };
  return { state: "stale", label: `行情已过期 · ${seconds} 秒前` };
}
