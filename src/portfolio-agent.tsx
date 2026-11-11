import { lazy, Suspense, useEffect, useRef, useState, type MouseEvent } from "react";
import { getAddress, isAddress } from "viem";
import { ArrowLeft, ArrowLeftRight, ArrowRight, Check, ChevronRight, CircleAlert, ExternalLink, LoaderCircle, Search, ShieldCheck, Sparkles, Square, Trash2, Wallet } from "lucide-react";
import { portfolioSources, type PortfolioAdvice, type PortfolioAiStatus, type PortfolioPosition, type PortfolioSourceId, type PortfolioWatchView } from "../shared/portfolio";
import { api } from "./api";
import type { Position } from "./types";
import { walletAddressPreference } from "./wallet-address-store";
import { PoolUniverse } from "./pool-universe";
import { RangeActivity } from "./range-activity";
import { PriceRangeIndicator, reciprocalPrice } from "./price-range-indicator";
import { LocalCodexConnection, useLocalCodex } from "./local-codex";
import { AgentEvaluation } from "./agent-evaluation";
import { ModelSettings } from "./model-settings";
import { agentPageFromHash, type AgentPage } from "./agent-pages";
import { PortfolioAdviceView } from "./portfolio-advice";
import "./portfolio-agent.css";

const AgentConsole = lazy(() => import("./agent-panel").then(module => ({ default: module.AgentPanel })));
type SourceProgress = { status: "waiting" | "loading" | "done" | "error" | "stopped"; scanned: number; total?: number; warnings: string[]; error?: string };
const initialProgress = (): Record<string, SourceProgress> => Object.fromEntries(portfolioSources.map(source => [source.id, { status: "waiting", scanned: 0, warnings: [] }]));
const labels = { "in-range": "区间内", outside: "已出区间", "full-range": "普通池", empty: "空仓位" };
const providers: Record<PortfolioAdvice["provider"], string> = { codex: "本机 Codex", gateway: "AI Gateway", deepseek: "DeepSeek", glm: "智谱 GLM", compatible: "兼容模型接口", rules: "规则" };
const format = (value?: number) => value === undefined ? "—" : new Intl.NumberFormat("zh-CN", { maximumSignificantDigits: 7 }).format(value);
const localRuntime = import.meta.env.VITE_LP_RUNTIME !== "cloud";

export function PortfolioAgent({ positions }: { positions: Position[] }) {
  const [page, setPage] = useState(() => agentPageFromHash(window.location.hash, localRuntime));
  const [openedPages, setOpenedPages] = useState<AgentPage[]>(() => page ? [page] : []);
  const [input, setInput] = useState("");
  const [savedAddress, setSavedAddress] = useState("");
  const [queriedAddress, setQueriedAddress] = useState("");
  const [storageMessage, setStorageMessage] = useState("");
  const [error, setError] = useState("");
  const [items, setItems] = useState<PortfolioPosition[]>([]);
  const [priceClock, setPriceClock] = useState(() => Date.now());
  const hasItems = items.length > 0;
  const [progress, setProgress] = useState(initialProgress);
  const [searching, setSearching] = useState(false);
  const [selectedKey, setSelectedKey] = useState("");
  const [invertedPriceKey, setInvertedPriceKey] = useState("");
  const [network, setNetwork] = useState("all");
  const [stockOnly, setStockOnly] = useState(false);
  const [serverAi, setAi] = useState<PortfolioAiStatus>();
  const localCodex = useLocalCodex(!localRuntime);
  const useLocalBridge = !localRuntime && localCodex.ready;
  const ai: PortfolioAiStatus | undefined = useLocalBridge
    ? { provider: "codex", available: true, label: "本机 Codex" }
    : serverAi ?? { provider: "unavailable", available: false, label: "正在检查分析服务" };
  const [checkingAi, setCheckingAi] = useState(true);
  const [aiError, setAiError] = useState("");
  const [analyzing, setAnalyzing] = useState("");
  const [advice, setAdvice] = useState<Record<string, PortfolioAdvice>>({});
  const [showConsole, setShowConsole] = useState(false);
  const [watchView, setWatchView] = useState<PortfolioWatchView>();
  const [watchBusy, setWatchBusy] = useState(false);
  const [watchError, setWatchError] = useState("");
  const [watchReadError, setWatchReadError] = useState("");
  const edited = useRef(false);
  const generation = useRef(0);
  const queryAbort = useRef<AbortController | null>(null);
  const analysisAbort = useRef<AbortController | null>(null);
  const analysisPanel = useRef<HTMLElement | null>(null);
  const mounted = useRef(true);
  const watchRevision = useRef(0);
  const homeHeading = useRef<HTMLHeadingElement | null>(null);
  const previousPage = useRef(page);

  useEffect(() => {
    const updatePage = () => {
      const next = agentPageFromHash(window.location.hash, localRuntime);
      if (next) setOpenedPages(current => current.includes(next) ? current : [...current, next]);
      setPage(next);
    };
    window.addEventListener("hashchange", updatePage);
    return () => window.removeEventListener("hashchange", updatePage);
  }, []);

  useEffect(() => {
    if (previousPage.current !== page) {
      (page ? document.getElementById(`agent-page-${page}`) : homeHeading.current)?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
      previousPage.current = page;
    }
  }, [page]);

  const checkAi = async (quiet = false) => {
    if (!quiet) {
      setCheckingAi(true);
      setAiError("");
    }
    try {
      const value = await api.portfolioAiStatus();
      if (mounted.current) setAi(value);
    } catch {
      if (mounted.current) {
        setAi({ provider: "unavailable", available: false, label: "无法连接分析服务" });
        if (!quiet) setAiError("请确认后端已启动，再重新检查分析服务。");
      }
    } finally {
      if (!quiet && mounted.current) setCheckingAi(false);
    }
  };

  useEffect(() => {
    let active = true;
    mounted.current = true;
    void walletAddressPreference("read").then(value => {
      if (!active || edited.current || !value || !isAddress(value, { strict: false })) return;
      setInput(value); setSavedAddress(value);
    }).catch(() => { if (active) setStorageMessage("无法读取本地地址；仍可输入地址查询。"); });
    void checkAi();
    const aiPoll = localRuntime ? window.setInterval(() => void checkAi(true), 10_000) : undefined;
    return () => {
      active = false;
      mounted.current = false;
      window.clearInterval(aiPoll);
      generation.current++;
      queryAbort.current?.abort();
      analysisAbort.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!localRuntime) return;
    let active = true;
    let timer: number;
    const check = async () => {
      const revision = watchRevision.current;
      try {
        const value = await api.portfolioWatch();
        if (active && revision === watchRevision.current) { setWatchView(value); setWatchReadError(""); }
      } catch {
        if (active && revision === watchRevision.current) { setWatchView(undefined); setWatchReadError("无法读取自动提醒状态，请检查本地服务。"); }
      } finally {
        if (active) timer = window.setTimeout(() => void check(), 15_000);
      }
    };
    void check();
    return () => { active = false; window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!hasItems) return;
    setPriceClock(Date.now());
    const timer = window.setInterval(() => setPriceClock(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, [hasItems]);

  const visible = items.filter(item => (network === "all" || String(item.chainId) === network) && (!stockOnly || item.token0.stock || item.token1.stock))
    .sort((left, right) => Number(left.status === "empty") - Number(right.status === "empty"));
  const selected = visible.find(item => item.key === selectedKey) ?? visible[0];
  const invertedPrice = Boolean(selected && invertedPriceKey === selected.key);
  const inversePrice = reciprocalPrice(selected?.currentPrice);
  const displayedPrice = invertedPrice ? inversePrice : selected?.currentPrice;
  const displayedLower = invertedPrice ? reciprocalPrice(selected?.upperPrice) : selected?.lowerPrice;
  const displayedUpper = invertedPrice ? reciprocalPrice(selected?.lowerPrice) : selected?.upperPrice;
  const displayedValue = invertedPrice
    ? selected?.valueQuote !== undefined && inversePrice !== undefined ? selected.valueQuote * inversePrice : undefined
    : selected?.valueQuote;
  const displayedPrincipal = displayedValue !== undefined && Number.isFinite(displayedValue) ? displayedValue : undefined;
  const quoteSymbol = invertedPrice ? selected?.token0.symbol : selected?.token1.symbol;
  const baseSymbol = invertedPrice ? selected?.token1.symbol : selected?.token0.symbol;
  const nextQuoteSymbol = invertedPrice ? selected?.token1.symbol : selected?.token0.symbol;
  const currentAdvice = selected ? advice[selected.key] : undefined;
  const completed = Object.values(progress).filter(item => item.status === "done").length;
  const incomplete = Object.values(progress).some(item => item.status === "error" || item.status === "stopped" || item.warnings.length);
  const watch = watchView?.watch;
  const watchMatches = Boolean(watch?.enabled && queriedAddress && watch.address.toLowerCase() === queriedAddress.toLowerCase());
  const watchedPosition = watchMatches && selected ? watch?.positions[selected.key] : undefined;
  const watchIssues = Object.values(watch?.sources ?? {}).filter(source => source?.error).length;

  const configureWatch = async (enabled: boolean) => {
    setWatchBusy(true); setWatchError("");
    watchRevision.current++;
    try {
      const result = await api.configurePortfolioWatch({ enabled, ...(enabled ? { address: queriedAddress } : {}) });
      setWatchView(current => ({ watch: result.watch, dwsReady: current?.dwsReady ?? false }));
    } catch (cause) { setWatchError(cause instanceof Error ? cause.message : "自动提醒设置失败"); }
    finally { setWatchBusy(false); }
  };

  const stop = (event?: MouseEvent<HTMLButtonElement>) => {
    // React reuses this button as the submit control when searching becomes false.
    event?.preventDefault();
    queryAbort.current?.abort(); setSearching(false);
    setProgress(current => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, value.status === "loading" ? { ...value, status: "stopped" } : value])) as typeof current);
  };

  const query = async (onlySource?: PortfolioSourceId) => {
    if (!isAddress(input.trim(), { strict: false }) || /^0x0{40}$/i.test(input.trim())) { setError("请输入有效的 EVM 钱包地址：0x 开头，共 42 位。"); return; }
    const address = getAddress(input.trim().toLowerCase());
    if (onlySource && address.toLowerCase() !== queriedAddress.toLowerCase()) { setError("输入地址已更改，请点击「查询 LP」开始新的查询。"); return; }
    edited.current = true;
    queryAbort.current?.abort(); analysisAbort.current?.abort();
    const controller = new AbortController(); queryAbort.current = controller;
    const currentGeneration = ++generation.current;
    const queryStartedAt = Date.now();
    let successfulSources = 0;
    setInput(address); setQueriedAddress(address); setError(""); setAiError(""); setAnalyzing(""); setSearching(true);
    if (!onlySource) { setItems([]); setAdvice({}); setSelectedKey(""); setNetwork("all"); setStockOnly(false); setProgress(initialProgress()); }
    else { setItems(current => current.filter(item => item.sourceId !== onlySource)); setAdvice({}); }
    const sources = onlySource ? portfolioSources.filter(item => item.id === onlySource) : portfolioSources;
    for (const source of sources) setProgress(current => ({ ...current, [source.id]: { status: "loading", scanned: 0, warnings: [] } }));
    void walletAddressPreference("save", address).then(() => { if (generation.current === currentGeneration) { setSavedAddress(address); setStorageMessage(""); } }).catch(() => { if (generation.current === currentGeneration) setStorageMessage("查询继续进行，但地址未能保存到 IndexedDB。请检查浏览器存储权限。"); });
    await Promise.all(sources.map(async source => {
      try {
        let cursor: string | undefined;
        let sourceWarnings = false;
        do {
          const page = await api.portfolioPage(address, source.id, cursor, controller.signal);
          if (currentGeneration !== generation.current || controller.signal.aborted) return;
          sourceWarnings ||= page.warnings.length > 0;
          setItems(current => [...new Map([...current, ...page.positions].map(item => [item.key, item])).values()]);
          setProgress(current => ({ ...current, [source.id]: { status: page.nextCursor ? "loading" : "done", scanned: page.scanned, total: page.total, warnings: [...new Set([...current[source.id].warnings, ...page.warnings])] } }));
          cursor = page.nextCursor;
        } while (cursor && !controller.signal.aborted);
        if (!controller.signal.aborted && !sourceWarnings) successfulSources++;
      } catch (cause) {
        if (controller.signal.aborted || currentGeneration !== generation.current) return;
        setProgress(current => ({ ...current, [source.id]: { ...current[source.id], status: "error", error: cause instanceof Error ? cause.message : "查询未完成，请重试" } }));
      }
    }));
    if (currentGeneration === generation.current) {
      setSearching(false);
      if (localRuntime && !controller.signal.aborted && successfulSources > 0) {
        try { await api.sampleWallet(address, queryStartedAt, controller.signal); }
        catch { if (!controller.signal.aborted && currentGeneration === generation.current) setStorageMessage("查询完成，但采样钱包未保存；请检查本地服务后重试查询。"); }
      }
    }
  };

  const analyze = async () => {
    if (!selected || !queriedAddress) return;
    const position = selected;
    const currentGeneration = generation.current;
    const controller = new AbortController(); analysisAbort.current = controller;
    setAnalyzing(position.key); setAiError("");
    try {
      const result = await (useLocalBridge ? localCodex.analyze(queriedAddress, position.sourceId, position.key, controller.signal) : api.portfolioAnalyze(queriedAddress, position.sourceId, position.key, controller.signal));
      if (currentGeneration !== generation.current) return;
      setItems(current => current.map(item => item.key === result.positionKey ? result.snapshot : item));
      setAdvice(current => ({ ...current, [position.key]: result }));
    } catch (cause) {
      if (!controller.signal.aborted && currentGeneration === generation.current) setAiError(cause instanceof Error ? cause.message : "分析失败，请重试");
    } finally { if (currentGeneration === generation.current) setAnalyzing(""); }
  };

  const forget = async () => {
    edited.current = true; stop(); generation.current++; analysisAbort.current?.abort();
    try {
      if (localRuntime) {
        watchRevision.current++;
        await api.configurePortfolioWatch({ enabled: false, clear: true });
        await api.sampleWallet(null, Date.now());
        setWatchView(current => ({ dwsReady: current?.dwsReady ?? false }));
      }
      await walletAddressPreference("clear");
      setSavedAddress(""); setInput(""); setQueriedAddress(""); setItems([]); setAdvice({}); setProgress(initialProgress()); setStorageMessage(""); setError(""); setAiError(""); setAnalyzing("");
    } catch { setStorageMessage("未能停止提醒或清除本地地址，请检查本地服务和浏览器存储权限后重试。"); }
  };

  return <div className="portfolio-workspace">
    <div hidden={Boolean(page)}>
    <header className="portfolio-heading"><div><h1 ref={homeHeading} tabIndex={-1}>LP 策略 Agent</h1><p>一个地址，查看多链流动性仓位，再决定下一步。</p></div><div className="portfolio-heading-status"><span className="portfolio-readonly"><ShieldCheck size={15} />只读分析</span>{!localRuntime ? <LocalCodexConnection connection={localCodex} /> : !serverAi || serverAi.provider === "codex" || serverAi.provider === "unavailable" ? <LocalCodexConnection connection={localCodex} developmentConnection={{ checking: checkingAi, available: Boolean(serverAi?.available), label: serverAi?.label ?? "无法连接分析服务", check: () => void checkAi() }} /> : <span className="portfolio-readonly">{serverAi.label}</span>}</div></header>
    <form className="portfolio-search" onSubmit={event => { event.preventDefault(); void query(); }}>
      <label htmlFor="portfolio-address"><Wallet size={16} />钱包地址</label>
      <div className="portfolio-search-row"><input id="portfolio-address" name="wallet-address" value={input} onChange={event => { edited.current = true; setInput(event.target.value); setError(""); }} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="输入 0x 开头的钱包地址" aria-describedby="portfolio-address-help" aria-invalid={Boolean(error)} />{searching ? <button className="wallet-button" type="button" onClick={stop}><Square size={15} />停止查询</button> : <button className="primary-button" type="submit"><Search size={16} />查询 LP</button>}</div>
      <div className="portfolio-address-help" id="portfolio-address-help"><span>{savedAddress ? "地址已保存在此浏览器的 IndexedDB，下次打开自动填入。" : "地址保存在此浏览器的 IndexedDB，无需连接钱包或签名。"}{localRuntime && " 查询成功后用于本机每日样本更新。"}</span>{savedAddress && <button type="button" onClick={() => void forget()}><Trash2 size={13} />清除本机地址</button>}</div>
      {storageMessage && <p className="portfolio-warning" role="status">{storageMessage}</p>}
      {error && <p className="portfolio-error" role="alert"><CircleAlert size={16} />{error}</p>}
      {localRuntime && <div className="portfolio-watch" aria-label="自动出区间提醒">
        <div className="portfolio-watch-header">
          <div><strong>自动出区间提醒</strong><span className={watch?.enabled ? "portfolio-watch-on" : ""}>{watchReadError ? "状态不可用" : !watchView ? "检查中" : watch?.enabled ? "监控中" : "未开启"}</span></div>
          <div className="portfolio-watch-actions">
            {watchView && watch?.enabled && <button type="button" className="wallet-button" disabled={watchBusy} onClick={() => void configureWatch(false)}>停止提醒</button>}
            {watchView && (!watch?.enabled || queriedAddress && !watchMatches) && <button type="button" className="wallet-button" disabled={watchBusy || !queriedAddress} onClick={() => void configureWatch(true)}>{watch?.enabled ? "切换到当前地址" : "开启提醒"}</button>}
          </div>
        </div>
        <p>约每 30 秒采样，链上核验连续 5 分钟未回到区间后，将脱敏仓位数据交给{serverAi && serverAi.provider !== "unavailable" ? providers[serverAi.provider] : "已配置的 AI 服务"}生成建议并发送钉钉私信；服务进程需保持运行。</p>
        {watch?.enabled && <p>监控地址 {watch.address.slice(0, 8)}…{watch.address.slice(-6)} · {Object.values(watch.positions).filter(item => item.status !== "unknown").length} 个仓位{watchIssues ? ` · ${watchIssues} 个来源暂不可用，相关计时已中断` : ""}</p>}
        {watchView && <p role="status">{watchView.dwsReady ? "钉钉已就绪，将发送给当前用户。" : `${watchView.dwsMessage || "钉钉未就绪"}；恢复后自动重试。`}</p>}
        {watchReadError && <p className="portfolio-error" role="alert"><CircleAlert size={16} />{watchReadError}</p>}
        {watchError && <p className="portfolio-error" role="alert"><CircleAlert size={16} />{watchError}</p>}
      </div>}
    </form>

    <div className="portfolio-columns">
      <section className="portfolio-holdings" aria-labelledby="portfolio-holdings-title">
        <div className="portfolio-section-heading"><h2 id="portfolio-holdings-title">LP 仓位</h2><span aria-live="polite">{queriedAddress ? `已发现 ${items.length} 个仓位` : "等待地址"}</span></div>
        <details className="portfolio-source-details"><summary>网络与来源<span aria-live="polite">{queriedAddress ? `${completed}/${portfolioSources.length} 完成` : `${portfolioSources.length} 个来源`}</span></summary>
        <div className="portfolio-source-grid" aria-label="支持的网络和平台">{portfolioSources.map(source => {
          const state = progress[source.id];
          return <div className={`portfolio-source ${state.status}`} key={source.id}><div><span className="portfolio-source-icon">{state.status === "loading" ? <LoaderCircle size={12} className="spin" /> : state.status === "done" ? <Check size={12} /> : state.status === "error" || state.status === "stopped" ? <CircleAlert size={12} /> : <span />}</span><strong>{source.network}</strong></div><small>{source.protocol}</small><span>{state.status === "waiting" ? "待查询" : state.status === "loading" ? state.total ? `${state.scanned.toLocaleString()} / ${state.total.toLocaleString()}` : "读取中" : state.status === "done" ? state.warnings.length ? "已返回 · 有提示" : "已完成" : state.status === "stopped" ? "未完成" : "暂不可用"}</span>{(state.status === "error" || state.status === "stopped") && <button type="button" disabled={searching} onClick={() => void query(source.id)}>重试</button>}</div>;
        })}</div>
        </details>
        {queriedAddress && <div className="portfolio-query-summary"><span title={queriedAddress}>查询地址 {queriedAddress.slice(0, 8)}…{queriedAddress.slice(-6)}</span><span role="status">{searching ? "Revert 查询中，已返回的仓位可以先分析" : incomplete ? "结果可能不完整，请展开来源提示" : ""}</span></div>}
        {queriedAddress && <details className="portfolio-diagnostics"><summary>查询范围与来源提示</summary><p>数据由 Revert 索引服务按地址返回，展示其已索引的活跃集中流动性仓位。Aerodrome 包含 Aero CL 与三个旧部署，以及 Revert 识别的质押归属。覆盖范围和索引进度见各来源提示。</p>{portfolioSources.map(source => {
          const state = progress[source.id];
          return state.error || state.warnings.length ? <div key={source.id}><strong>{source.network} · {source.protocol}</strong><p>{[state.error, ...state.warnings].filter(Boolean).join(" ")}</p></div> : null;
        })}</details>}
        {items.length > 0 && <div className="portfolio-filters"><label>网络<select value={network} onChange={event => setNetwork(event.target.value)}><option value="all">全部网络</option>{[...new Map(portfolioSources.map(source => [source.chainId, source.network])).entries()].map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select></label><label className="portfolio-stock-filter"><input type="checkbox" checked={stockOnly} onChange={event => setStockOnly(event.target.checked)} />仅已核验股票代币</label></div>}
        {visible.length > 0 ? <div className="portfolio-position-list">{visible.map(item => <button type="button" className={`portfolio-position ${selected?.key === item.key ? "selected" : ""}`} key={item.key} onClick={() => { setSelectedKey(item.key); setAiError(""); if (window.matchMedia("(max-width: 700px)").matches) { analysisPanel.current?.focus({ preventScroll: true }); analysisPanel.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); } }} aria-pressed={selected?.key === item.key}>
          <div className="portfolio-pair"><strong>{item.token0.symbol} <span>/</span> {item.token1.symbol}</strong><span className={`portfolio-range-status ${item.status}`}>{labels[item.status]}</span></div>
          <div className="portfolio-position-meta"><span>{item.network} · {item.protocol}</span><span>{item.tokenId ? `NFT #${item.tokenId}` : "普通 LP 份额"}{item.staked ? " · 已质押" : ""}</span>{(item.token0.stock || item.token1.stock) && <span className="portfolio-stock-tag">股票代币</span>}</div>
          <div className="portfolio-position-bottom"><div><span>{format(item.token0.amount)} {item.token0.symbol}</span><span>{format(item.token1.amount)} {item.token1.symbol}</span></div><span className="portfolio-position-signal"><PriceRangeIndicator position={item} inverted={invertedPriceKey === item.key} now={priceClock} /><ChevronRight className="portfolio-select-label" size={15} aria-hidden="true" /></span></div>
        </button>)}</div> : <div className="portfolio-empty"><Search size={28} /><h3>{searching ? "正在通过 Revert 发现仓位" : stockOnly ? "当前没有已核验的股票代币 LP" : queriedAddress ? "当前没有返回 LP 仓位" : "先找到你的流动性仓位"}</h3><p>{searching ? "不同来源会陆续返回，使用 Revert 的地址索引分页查询。可随时停止并保留已返回结果。" : queriedAddress ? "核对地址、筛选条件和来源状态。暂不可用或未完成的来源，不代表没有持仓。" : "输入钱包地址，查询 Uniswap、Aerodrome、PancakeSwap 等平台。股票代币 LP 会与其他仓位一起显示。"}</p></div>}
      </section>

      <aside className="portfolio-analysis" aria-label="LP 详情与分析" ref={analysisPanel} tabIndex={-1}>
        <div className="portfolio-section-heading"><h2><Sparkles size={17} />LP 详情与分析</h2><span>{ai?.available ? ai.label : "只读数据"}</span></div>
        {!selected ? <div className="portfolio-analysis-empty"><div className="portfolio-analysis-mark"><Sparkles size={24} /></div><h3>让每次调整都有依据</h3><p>查询后选择左侧 LP，在这里根据 Revert 仓位数据获取优化建议。</p><ol><li>核对仓位与当前区间</li><li>比较持有、调仓与退出的取舍</li><li>明确成本、风险和下一步</li></ol></div> : <>
          <div className="portfolio-selected-heading"><div><h3>{selected.token0.symbol} / {selected.token1.symbol}</h3><p>{selected.network} · {selected.protocol}{selected.tokenId ? ` · NFT #${selected.tokenId}` : ""}{selected.staked ? " · 已质押" : ""}</p></div><div className="portfolio-selected-links"><span className={`portfolio-range-status ${selected.status}`}>{labels[selected.status]}</span><a href={selected.revertUrl ?? selected.explorerUrl} target="_blank" rel="noreferrer">{selected.revertUrl ? "在 Revert 查看" : "链上核验"}<ExternalLink size={12} /></a></div></div>
          {selected.dataStale && <p className="portfolio-warning" role="status">Revert 数据已过期，请重新查询后再分析。</p>}
          {watchedPosition && <div className="portfolio-watch-position" aria-live="polite">
            <strong>自动提醒</strong>
            <span>{watchedPosition.delivery === "sent" ? "钉钉已送达" : watchedPosition.delivery === "pending" ? "钉钉投递中" : watchedPosition.delivery === "sending" ? "正在发送钉钉" : watchedPosition.delivery === "uncertain" ? "钉钉结果待核验" : watchedPosition.delivery === "analyzing" ? "已确认，正在生成建议" : watchedPosition.verifiedAt ? "已确认，等待处理" : watchedPosition.confirmedAt ? "5 分钟采样完成，等待链上核验" : watchedPosition.status === "outside" && watchedPosition.outsideSince ? `区间外采样 ${Math.min(5, Math.floor((Date.now() - Date.parse(watchedPosition.outsideSince)) / 60_000))} / 5 分钟` : watchedPosition.status === "unknown" ? "数据不可用，计时已中断" : watchedPosition.alerted ? "等待重新回到区间" : "观察中"}</span>
            {watchedPosition.error && <p className="portfolio-warning">{watchedPosition.error}</p>}
            {watchedPosition.advice && <p>AI 建议：{watchedPosition.advice.summary}{!watchedPosition.advice.options && watchedPosition.advice.strategy && `；${watchedPosition.advice.strategy}`}</p>}
            {watchedPosition.advice?.options && <p>保守：{watchedPosition.advice.options.conservative.summary}；激进：{watchedPosition.advice.options.aggressive.summary}</p>}
          </div>}
          {selected.performance && <dl className="portfolio-overview" aria-label="仓位关键指标">
            <div><dt>本金 / USD</dt><dd>{format(selected.performance.principalUsd)}</dd></div>
            <div><dt>总损益 · HOLD / USD</dt><dd>{format(selected.performance.totalPnlUsd)}</dd></div>
            <div><dt>累计手续费 / USD</dt><dd>{format(selected.performance.totalFeesUsd)}</dd></div>
            <div><dt>历史手续费 APR{selected.performance.feeAprExperimental && " · 实验值"}</dt><dd>{format(selected.performance.feeAprPercent)}{selected.performance.feeAprPercent === undefined ? "" : "%"}</dd></div>
          </dl>}
          <div className="portfolio-price-direction">
            <button type="button" onClick={() => setInvertedPriceKey(invertedPrice ? "" : selected.key)}>
              <ArrowLeftRight size={14} aria-hidden="true" />切换为 {nextQuoteSymbol} 计价
            </button>
          </div>
          <dl className="portfolio-facts">
            <div><dt>数据来源</dt><dd>{selected.dataSource === "revert" ? "Revert Finance" : "链上 RPC"}</dd></div>
            <div><dt>池内价格</dt><dd aria-live="polite">{format(displayedPrice)} {quoteSymbol}/{baseSymbol}</dd></div>
            {selected.kind === "concentrated" && <div><dt>LP 区间</dt><dd>{format(displayedLower)} — {format(displayedUpper)} {quoteSymbol}/{baseSymbol}</dd></div>}
            <div><dt>本金估值</dt><dd>{format(displayedPrincipal)} {quoteSymbol}</dd></div>
            {selected.blockNumber && <div><dt>快照区块</dt><dd>#{selected.blockNumber}</dd></div>}
            <div><dt>{selected.dataSource === "revert" ? "索引数据时间" : "链上时间"}</dt><dd>{new Date(selected.updatedAt).toLocaleString("zh-CN", { hour12: false })}</dd></div>
          </dl>
          <RangeActivity key={`${queriedAddress}:${selected.key}`} address={queriedAddress} position={selected} />
          {selected.performance && <details className="portfolio-diagnostics">
            <summary>Revert 收益与费用 · HOLD / USD</summary>
            <dl className="portfolio-facts">
              <div><dt>池子损益 USD</dt><dd>{format(selected.performance.poolPnlUsd)}</dd></div>
              <div><dt>价格分歧损益 USD</dt><dd>{format(selected.performance.divergenceUsd)}</dd></div>
              <div><dt>累计 ROI</dt><dd>{format(selected.performance.roiPercent)}{selected.performance.roiPercent === undefined ? "" : "%"}</dd></div>
              <div><dt>历史总 APR</dt><dd>{format(selected.performance.totalAprPercent)}{selected.performance.totalAprPercent === undefined ? "" : "%"}</dd></div>
              <div><dt>待领手续费 USD</dt><dd>{format(selected.performance.uncollectedFeesUsd)}</dd></div>
              <div><dt>累计奖励 USD</dt><dd>{format(selected.performance.rewardsUsd)}</dd></div>
              <div><dt>待领奖励 USD</dt><dd>{format(selected.performance.unclaimedRewardsUsd)}</dd></div>
              <div><dt>仓位年龄</dt><dd>{format(selected.performance.ageDays)} 天</dd></div>
            </dl>
          </details>}
          {selected.performance?.feeAprExperimental && <p className="portfolio-warning">Revert 将此手续费 APR 标记为实验值，请结合累计手续费与仓位年龄核对。</p>}
          {[selected.token0, selected.token1].filter(item => item.stock).map(item => <p className="portfolio-stock-note" key={item.address}><ShieldCheck size={14} />{item.symbol} · {item.stock!.issuer} 合约目录已核验。公司行动倍数 {item.stock!.multiplier}；不以股票现货价替代池内价格。</p>)}
          <button className="primary-button portfolio-analyze-button" type="button" disabled={!ai?.available || selected.dataStale || Boolean(analyzing)} onClick={() => void analyze()}>{analyzing === selected.key ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}{analyzing === selected.key ? "补充历史并分析…" : analyzing ? "另一个仓位正在分析" : currentAdvice ? "重新获取 AI 建议" : "获取 AI 优化建议"}{!analyzing && <ArrowRight size={16} />}</button>
          <p className="portfolio-analysis-disclosure">点击后将脱敏仓位快照、收益历史、现金流和 Top 50 池历史基准发送给 {ai && ai.provider !== "unavailable" ? providers[ai.provider] : "所选模型服务"}，生成调整建议。{invertedPrice && `AI 分析使用 ${selected.token1.symbol}/${selected.token0.symbol} 方向的原始快照。`}</p>
          {analyzing === selected.key && <div className="portfolio-analysis-loading" role="status"><span /><span /><span /><p>正在补充仓位历史、近30日池数据与现金流，再生成调整策略。</p></div>}
          {selected.history && <details className="portfolio-diagnostics">
            <summary>历史样本 · 仓位 {selected.history.position.sampleCount} 条 / {selected.history.position.coveredDays.toFixed(1)} 天 · 池 {selected.history.pool.sampleCount} 日</summary>
            <p>仓位采样从 {selected.history.position.from ? new Date(selected.history.position.from).toLocaleString("zh-CN") : "待补充"} 到 {selected.history.position.to ? new Date(selected.history.position.to).toLocaleString("zh-CN") : "待补充"}。</p>
            <p>已读取 {selected.history.position.dailyFees.length} 日手续费、{selected.history.position.dailyRewards.length} 日奖励、{selected.cashFlows?.eventCount ?? 0} 条现金流。池级参考覆盖最近 {selected.history.lookbackDays} 个完整 UTC 日中的 {selected.history.pool.sampleCount} 日。</p>
            {selected.history.market && <p>Top 50 基准共 {selected.history.market.poolCount} 池、{selected.history.market.sampleCount} 条日样本，{selected.history.market.completePools} 池覆盖完整窗口。同链同币对参考 {selected.history.market.samePairReferences.length} 池，按代币合约匹配。</p>}
            {selected.history.position.downsampled && <p>历史快照已抽样，分析摘要保留实际样本数量与最大采样间隔。</p>}
            {selected.history.warnings.map((warning, index) => <p className="portfolio-warning" key={index}>{warning}</p>)}
          </details>}
          {currentAdvice && <PortfolioAdviceView advice={currentAdvice} providerLabel={providers[currentAdvice.provider]} />}

        </>}
        {!ai?.available && <div className="portfolio-ai-retry"><p className="portfolio-warning">{checkingAi ? "正在检查 AI 服务…" : ai?.label}</p><button type="button" className="wallet-button" disabled={checkingAi} onClick={() => { void checkAi(); void localCodex.check(); }}>{checkingAi ? "检查中…" : "重新检查分析服务"}</button></div>}
        {aiError && <p className="portfolio-error" role="alert"><CircleAlert size={16} />{aiError}</p>}
      </aside>
    </div>
    {import.meta.env.VITE_LP_RUNTIME !== "cloud" && <details className="portfolio-advanced" onToggle={event => setShowConsole(event.currentTarget.open)}><summary>高级：事件观察与成本演练</summary>{showConsole && <Suspense fallback={<p role="status">正在读取控制台…</p>}><AgentConsole positions={positions} /></Suspense>}</details>}
    </div>
    {openedPages.includes("model") && <section className="portfolio-workbench" aria-labelledby="agent-page-model" hidden={page !== "model"}>
      <a className="portfolio-workbench-back" href="#main"><ArrowLeft size={15} aria-hidden="true" />返回 LP 策略 Agent</a>
      <header className="portfolio-heading"><div><h1 id="agent-page-model" tabIndex={-1}>模型与运行</h1><p>管理模型连接、服务状态与调用用量。</p></div></header>
      {localRuntime ? <ModelSettings onChanged={() => void checkAi(true)} initiallyOpen /> : <p className="portfolio-page-note">模型设置在本地版使用。</p>}
    </section>}
    {openedPages.includes("evaluation") && <section className="portfolio-workbench" aria-labelledby="agent-page-evaluation" hidden={page !== "evaluation"}>
      <a className="portfolio-workbench-back" href="#main"><ArrowLeft size={15} aria-hidden="true" />返回 LP 策略 Agent</a>
      <header className="portfolio-heading"><div><h1 id="agent-page-evaluation" tabIndex={-1}>Agent 测评</h1><p>查看策略建议质量与事件风控测评。</p></div></header>
      {localRuntime ? <AgentEvaluation /> : <p className="portfolio-page-note">Agent 测评在本地版使用。</p>}
    </section>}
    {openedPages.includes("samples") && <section className="portfolio-workbench" aria-labelledby="agent-page-samples" hidden={page !== "samples"}>
      <a className="portfolio-workbench-back" href="#main"><ArrowLeft size={15} aria-hidden="true" />返回 LP 策略 Agent</a>
      <header className="portfolio-heading"><div><h1 id="agent-page-samples" tabIndex={-1}>样本数据</h1><p>查看钱包 LP 的近 30 日样本与每日更新情况。</p></div></header>
      <PoolUniverse localRuntime={localRuntime} />
    </section>}
  </div>;
}
