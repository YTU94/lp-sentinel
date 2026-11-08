import { useEffect, useRef, useState } from "react";
import type { UniswapPoolUniverse } from "../shared/pool-universe";
import { api } from "./api";

const usd = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 });

export function PoolUniverse() {
  const [data, setData] = useState<UniswapPoolUniverse>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const request = useRef<AbortController | null>(null);

  const load = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await api.poolUniverse(controller.signal);
      if (!controller.signal.aborted) setData(result);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "历史样本暂不可用");
    } finally { if (!controller.signal.aborted) setLoading(false); }
  };

  useEffect(() => { void load(); return () => request.current?.abort(); }, []);

  return <section className="portfolio-pool-universe" aria-labelledby="pool-universe-title">
    <div className="portfolio-section-heading">
      <h2 id="pool-universe-title">Uniswap · TVL Top 50</h2>
      <span>{data ? `${data.sampledPools}/${data.pools.length} 池已采样` : "跨链历史数据池"}</span>
    </div>
    {loading && <p role="status">正在读取排名并采样最近 30 个完整 UTC 日…</p>}
    {error && <div role="alert"><p className="portfolio-error">{error}</p><button className="wallet-button" type="button" onClick={() => void load()}>重新读取样本</button></div>}
    {data && <>
      <p>{data.pools.length} 个池 · TVL {usd.format(data.totalTvlUsd)} · {data.sampleCount.toLocaleString()} 条日样本 · {data.completePools} 池覆盖完整 30 日</p>
      <p className="portfolio-pool-period">{data.from} — {data.to} UTC · DeFiLlama · 排名读取于 {new Date(data.rankedAt).toLocaleString("zh-CN", { hour12: false })}</p>
      <details className="portfolio-diagnostics">
        <summary>查看 {data.pools.length} 个池与采样覆盖</summary>
        <div className="portfolio-pool-table" tabIndex={0} role="region" aria-label="Uniswap Top 50 池排名，可横向滚动">
          <table>
            <thead><tr><th scope="col">排名</th><th scope="col">池 / 网络 / 协议</th><th scope="col">TVL</th><th scope="col">基础 APY</th><th scope="col">历史日数</th></tr></thead>
            <tbody>{data.pools.map(pool => <tr key={pool.id}>
              <td>{pool.rank}</td>
              <td><a href={`https://defillama.com/yields/pool/${pool.id}`} target="_blank" rel="noreferrer">{pool.pair}</a><small>{pool.chain} · {pool.protocol.replace("uniswap-v", "Uniswap V")} {pool.feeLabel}</small></td>
              <td>{usd.format(pool.tvlUsd)}</td>
              <td>{pool.baseApyPercent === undefined ? "待补充" : `${pool.baseApyPercent.toFixed(2)}%`}</td>
              <td>{pool.history.sampleCount}/{data.lookbackDays}{pool.history.status === "unavailable" ? " · 暂不可用" : ""}</td>
            </tr>)}</tbody>
          </table>
        </div>
        {data.warnings.map(warning => <p key={warning}>{warning}</p>)}
      </details>
    </>}
  </section>;
}
