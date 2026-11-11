import type { PortfolioPosition } from "../shared/portfolio";

const formatter = new Intl.NumberFormat("zh-CN", { maximumSignificantDigits: 7 });
const validPrice = (value?: number): value is number => value !== undefined && Number.isFinite(value) && value > 0;

export function reciprocalPrice(value?: number) {
  if (!validPrice(value)) return undefined;
  const inverted = 1 / value;
  return validPrice(inverted) ? inverted : undefined;
}

export function PriceRangeIndicator({ position, inverted, now }: { position: PortfolioPosition; inverted: boolean; now: number }) {
  const snapshotTime = Date.parse(position.updatedAt);
  const stale = Boolean(position.dataStale) || !Number.isFinite(snapshotTime) || now - snapshotTime > 180_000 || snapshotTime > now + 5_000;
  const staleLabel = stale ? " · 已过期" : "";
  if (position.status === "empty") return <span className="portfolio-price-gauge-empty">空仓不显示位置{staleLabel}</span>;
  if (position.status === "full-range" || position.kind === "classic") return <span className="portfolio-price-gauge-empty">普通池无区间{staleLabel}</span>;

  const current = inverted ? reciprocalPrice(position.currentPrice) : position.currentPrice;
  const lower = inverted ? reciprocalPrice(position.upperPrice) : position.lowerPrice;
  const upper = inverted ? reciprocalPrice(position.lowerPrice) : position.upperPrice;
  if (!validPrice(current) || !validPrice(lower) || !validPrice(upper) || upper <= lower) {
    return <span className="portfolio-price-gauge-empty">区间位置不可用{staleLabel}</span>;
  }

  const quote = inverted ? position.token0.symbol : position.token1.symbol;
  const base = inverted ? position.token1.symbol : position.token0.symbol;
  const below = inverted ? current <= lower : current < lower;
  const above = inverted ? current > upper : current >= upper;
  const outside = below || above;
  const inconsistent = outside !== (position.status === "outside");
  const relation = inconsistent ? "价格与仓位状态不一致，请核对" : !outside ? "区间内" : current === lower || current === upper ? "达到边界，已出区间" : below ? "低于区间" : "高于区间";
  const ratio = (current - lower) / (upper - lower);
  const rawMarker = 30 + 40 * ratio;
  const marker = Math.max(5, Math.min(95, rawMarker));
  const clipped = rawMarker < 5 || rawMarker > 95;
  const state = stale ? "stale" : inconsistent ? "unknown" : outside ? "outside" : "in-range";
  const notices = [stale && "已过期", inconsistent && "待核对", clipped && "超出图示"].filter(Boolean).join(" · ");
  const description = `${stale ? "快照已过期；" : ""}${relation}；池价 ${formatter.format(current)} ${quote}/${base}；区间 ${formatter.format(lower)} 至 ${formatter.format(upper)}${clipped ? "；价格超出图示范围，标记停在边缘" : ""}`;

  return <span className={`portfolio-price-gauge ${state}`} role="img" aria-label={description} title={description}>
    <span className="portfolio-price-gauge-track" aria-hidden="true">
      <span className="portfolio-price-gauge-band" />
      <span className="portfolio-price-gauge-marker" style={{ left: `${marker}%` }} />
    </span>
    <span className="portfolio-price-gauge-caption" aria-hidden="true">{notices && <span className="portfolio-price-gauge-notices">{notices}</span>}<span className="portfolio-price-gauge-value">{formatter.format(current)} {quote}/{base}</span></span>
  </span>;
}
