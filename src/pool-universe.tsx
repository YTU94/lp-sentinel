import { useEffect, useState } from "react";
import type { UniswapPoolUniverse } from "../shared/pool-universe";
import type { SampleView, WalletSample } from "../shared/samples";
import { api } from "./api";

const usd = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });
const number = new Intl.NumberFormat("zh-CN", { maximumSignificantDigits: 6 });
const money = (value?: number) => value === undefined ? "—" : usd.format(value);
const price = (value?: number) => value === undefined ? "—" : number.format(value);
const priceRange = (low?: number, high?: number) => low === undefined && high === undefined ? "—" : `${price(low)} — ${price(high)}`;
const dateTime = (value: string) => new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
const masked = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

function WalletPosition({ sample }: { sample: WalletSample }) {
  const { position, history } = sample;
  const today = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const days = (history.rangeActivity?.days ?? []).filter(day => day.date < today && day.seconds.future === 0).slice(-30);
  const inRange = days.reduce((sum, day) => sum + day.seconds["in-range"], 0);
  const active = inRange + days.reduce((sum, day) => sum + day.seconds["out-of-range"], 0);
  const known = active + days.reduce((sum, day) => sum + day.seconds.inactive, 0);
  const elapsed = known + days.reduce((sum, day) => sum + day.seconds.unknown, 0);
  const pool = history.pool;
  const latestTvl = [...pool.days].reverse().find(day => day.tvlUsd !== undefined)?.tvlUsd;
  const fees = history.position.dailyFees;
  const dates = [...new Set([...pool.days.map(day => day.date), ...fees.map(day => day.date)])].sort();

  return <article className="sample-position">
    <div className="sample-position-heading">
      <h3>{position.token0.symbol} / {position.token1.symbol}</h3>
      <span>{position.network}{position.tokenId && ` · NFT #${position.tokenId}`} · {position.dataStale ? "快照已过期" : position.status === "outside" ? "已出区间" : "区间内"} · {dateTime(position.updatedAt)}</span>
    </div>
    <dl className="sample-position-facts">
      <div><dt>当前价 / 区间 · {position.token1.symbol}/{position.token0.symbol}</dt><dd>{price(position.currentPrice)} · {priceRange(position.lowerPrice, position.upperPrice)}</dd></div>
      <div><dt>历史采样价格范围</dt><dd>{priceRange(history.position.priceMin, history.position.priceMax)} <small>{position.token1.symbol}/{position.token0.symbol} · {history.position.sampleCount} 条快照</small></dd></div>
      <div><dt>已知持仓时段在区间内</dt><dd>{active ? `${(inRange / active * 100).toFixed(1)}%` : "—"} <small>北京时间 {days.length} 个完整日（最多 29 日） · 已知覆盖 {elapsed ? `${(known / elapsed * 100).toFixed(1)}%` : "—"}{history.rangeActivity && (history.rangeActivity.source === "revert+onchain" ? " · 快照与事件" : " · 快照估算")}</small></dd></div>
      <div><dt>池日样本 / 最近池 TVL</dt><dd>{pool.sampleCount}/30 日 · {money(latestTvl)} <small>完整 UTC 日 · Revert</small></dd></div>
      <div><dt>已覆盖日池交易量 / 池手续费</dt><dd>{money(pool.volumeUsd)} / {money(pool.feesUsd)} <small>池级指标，并非个人收益</small></dd></div>
      <div><dt>个人手续费日样本</dt><dd>{fees.length ? money(fees.reduce((sum, day) => sum + day.usd, 0)) : "—"} <small>已返回 {fees.length}/30 个 UTC 日</small></dd></div>
    </dl>
    <details className="portfolio-diagnostics">
      <summary>查看每日池样本与数据说明</summary>
      <div className="portfolio-pool-table" tabIndex={0} role="region" aria-label={`${position.token0.symbol} / ${position.token1.symbol} 每日池样本，可横向滚动`}>
        <table>
          <thead><tr><th scope="col">日期 UTC</th><th scope="col">池 TVL</th><th scope="col">池交易量</th><th scope="col">池手续费</th><th scope="col">个人手续费</th></tr></thead>
          <tbody>{dates.map(date => {
            const day = pool.days.find(item => item.date === date);
            return <tr key={date}><td>{date}</td><td>{money(day?.tvlUsd)}</td><td>{money(day?.volumeUsd)}</td><td>{money(day?.feesUsd)}</td><td>{money(fees.find(fee => fee.date === date)?.usd)}</td></tr>;
          })}</tbody>
        </table>
      </div>
      {!dates.length && <p>池历史与个人手续费日样本暂不可用。</p>}
      <p>价格范围来自有限快照，并非区间内的最高和最低成交价。有效时间由 Revert 快照估算，必要时以链上事件补缺；未知时段不计入占比。</p>
      {history.warnings.map((warning, index) => <p className="portfolio-warning" key={index}>{warning}</p>)}
      {history.rangeActivity?.warnings.map((warning, index) => <p className="portfolio-warning" key={`range-${index}`}>{warning}</p>)}
    </details>
  </article>;
}

function Top50({ data }: { data: UniswapPoolUniverse }) {
  return <section className="portfolio-pool-universe" aria-labelledby="pool-universe-title">
    <div className="portfolio-section-heading"><h2 id="pool-universe-title">Uniswap · TVL Top 50</h2><span>{data.sampledPools}/{data.pools.length} 池已采样</span></div>
    <p>{data.pools.length} 个池 · TVL {usd.format(data.totalTvlUsd)} · {data.sampleCount.toLocaleString()} 条日样本 · {data.completePools} 池覆盖完整 30 日</p>
    <p className="portfolio-pool-period">{data.from} — {data.to} UTC · DeFiLlama · 排名读取于 {dateTime(data.rankedAt)}</p>
    <details className="portfolio-diagnostics">
      <summary>查看 {data.pools.length} 个池与采样覆盖</summary>
      <div className="portfolio-pool-table" tabIndex={0} role="region" aria-label="Uniswap Top 50 池排名，可横向滚动">
        <table>
          <thead><tr><th scope="col">排名</th><th scope="col">池 / 网络 / 协议</th><th scope="col">TVL</th><th scope="col">基础 APY</th><th scope="col">历史日数</th></tr></thead>
          <tbody>{data.pools.map(pool => <tr key={pool.id}>
            <td>{pool.rank}</td>
            <td><a href={`https://defillama.com/yields/pool/${pool.id}`} target="_blank" rel="noreferrer">{pool.pair}</a><small>{pool.chain} · {pool.protocol.replace("uniswap-v", "Uniswap V")} {pool.feeLabel}</small></td>
            <td>{usd.format(pool.tvlUsd)}</td><td>{pool.baseApyPercent === undefined ? "待补充" : `${pool.baseApyPercent.toFixed(2)}%`}</td>
            <td>{pool.history.sampleCount}/{data.lookbackDays}{pool.history.status === "unavailable" ? " · 暂不可用" : ""}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {data.warnings.map(warning => <p key={warning}>{warning}</p>)}
    </details>
  </section>;
}

export function PoolUniverse({ localRuntime }: { localRuntime: boolean }) {
  const [sample, setSample] = useState<SampleView>();
  const [cloudData, setCloudData] = useState<UniswapPoolUniverse>();
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        if (localRuntime) setSample(await api.samples(controller.signal));
        else setCloudData(await api.poolUniverse(controller.signal));
        if (!controller.signal.aborted) setError("");
      } catch {
        if (!controller.signal.aborted) setError("样本数据暂不可用，请检查服务后重试。");
      } finally {
        if (localRuntime && !controller.signal.aborted) timer = setTimeout(() => void load(), 5_000);
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [localRuntime]);

  const refresh = async () => {
    setRefreshing(true); setError("");
    try {
      if (localRuntime) setSample(await api.refreshSamples());
      else setCloudData(await api.poolUniverse(new AbortController().signal));
    } catch { setError("样本更新未能启动，请检查服务后重试。"); }
    finally { setRefreshing(false); }
  };

  const snapshot = sample?.snapshot;
  const universe = localRuntime ? snapshot?.universe : cloudData;
  return <div className="samples-page">
    <section className="sample-summary" aria-labelledby="sample-summary-title">
      <div className="portfolio-section-heading">
        <h2 id="sample-summary-title">样本概览</h2>
        <button className="wallet-button" type="button" disabled={refreshing || sample?.updating} onClick={() => void refresh()}>{sample?.updating ? "更新中…" : localRuntime ? "立即更新" : "重新读取"}</button>
      </div>
      {localRuntime ? <>
        <p>每天北京时间 08:10 自动更新最近 30 日；优先使用首页最近一次成功查询的钱包，无法取得钱包历史时使用 Top 50。</p>
        <p>钱包样本覆盖 Revert 已索引的 Uniswap V3 非空仓位；Uniswap V2、V4 钱包仓位暂不支持。</p>
        <p>地址和样本保存在本机服务；服务关闭时暂停，重启后补采。清除首页地址会同时清除采样钱包。</p>
        <dl className="sample-summary-facts">
          <div><dt>采样钱包</dt><dd>{sample?.wallet ? masked(sample.wallet) : "等待首页成功查询"}</dd></div>
          <div><dt>当前样本</dt><dd>{snapshot ? snapshot.mode === "wallet" ? `${snapshot.positions.length} 个钱包 LP` : "TVL Top 50 兜底" : "等待更新"}</dd></div>
          <div><dt>上次完成</dt><dd>{snapshot ? dateTime(snapshot.capturedAt) : "—"}</dd></div>
          <div><dt>下次更新</dt><dd>{sample?.nextUpdateAt ? dateTime(sample.nextUpdateAt) : "—"}</dd></div>
        </dl>
        {sample?.updating && <p role="status">正在采集钱包与历史样本；首次回放可能需要较长时间。</p>}
        {sample?.error && <p className="portfolio-warning" role="alert">{sample.error}</p>}
        {snapshot?.fallbackReason && <p className="portfolio-warning">{snapshot.fallbackReason} 当前展示池级参考，不代表钱包收益。</p>}
        {snapshot?.warnings.map(warning => <p className="portfolio-warning" key={warning}>{warning}</p>)}
      </> : <p>云端仅提供 Top 50 池级参考，重新读取可能返回缓存；每日钱包采样需要本地服务运行。</p>}
      {error && <p className="portfolio-error" role="alert">{error}</p>}
    </section>
    {snapshot?.mode === "wallet" && <section className="sample-positions" aria-labelledby="sample-wallet-title">
      <div className="portfolio-section-heading"><h2 id="sample-wallet-title">钱包 LP 样本</h2><span>近 30 日 · Revert 索引，按需链上回填</span></div>
      {snapshot.positions.map(item => <WalletPosition key={item.position.key} sample={item} />)}
    </section>}
    {universe && <Top50 data={universe} />}
    {snapshot?.mode === "top50" && sample?.previousWalletSnapshot && <section className="sample-positions" aria-labelledby="sample-previous-title">
      <div className="portfolio-section-heading"><h2 id="sample-previous-title">上次钱包样本</h2><span>可能已过期 · {dateTime(sample.previousWalletSnapshot.capturedAt)}</span></div>
      {sample.previousWalletSnapshot.positions.map(item => <WalletPosition key={item.position.key} sample={item} />)}
    </section>}
    {!sample && !cloudData && !error && <p role="status">正在读取样本状态…</p>}
    {sample && !snapshot && !sample.updating && !sample.error && <p>尚无样本，等待服务开始更新。</p>}
  </div>;
}
