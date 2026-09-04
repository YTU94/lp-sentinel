import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Bell, BellRing, ChevronRight, CircleDollarSign, ExternalLink, Gauge, LoaderCircle, Pause, Play, Plus, RefreshCw, ScrollText, Search, Settings as SettingsIcon, ShieldCheck, Trash2, WalletCards, X, Zap } from 'lucide-react';
import changelogMarkdown from '../CHANGELOG.md?raw';
import packageInfo from '../package.json';
import { api } from './api';
import { ActionStateMachine } from './action-state-machine';
import { deriveActionStage } from './action-state-machine';
import { parseChangelog } from './changelog';
import { priceFreshness } from './price-freshness';
import { formatTokenAmount } from './token-selection';
import { IndexedDbPositionStore, storedPositionKey, toStoredPosition } from './indexeddb-position-store';
import type { AppState, LiveLpPosition, LpLookup, Position, RuntimeCapabilities, Settings } from './types';
import { connectPancakeWallet } from './wallet/pancake-v3';
import { removeAllLiquidity } from './wallet/removal';

const number = (value: number | null | undefined, digits = 4) => value == null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: digits });
const compactAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
const localRuntime: RuntimeCapabilities = { mode: 'local', persistent: true, backgroundMonitoring: true, notifications: true, notificationProvider: 'dws', positionStorage: 'indexeddb' };
const positionStore = new IndexedDbPositionStore();
const appVersion = packageInfo.version;
const changelogReleases = parseChangelog(changelogMarkdown);

function StatusPill({ position }: { position: Position }) {
  const fresh = priceFreshness(position.snapshot);
  const stage = deriveActionStage({ currentPrice: position.currentPrice, rangeLower: position.rangeLower, rangeUpper: position.rangeUpper, alertLower: position.alertLower, alertUpper: position.alertUpper, alertArmed: position.alertState.armed, stale: fresh.stale });
  const text = !position.enabled ? '已暂停' : stage === 'stale' ? '数据过期' : fresh.status === 'delayed' ? '数据延迟' : stage === 'safe' ? '安全区间' : stage === 'warning' ? '接近边界' : '已越界';
  const statusClass = !position.enabled ? 'paused' : stage === 'stale' ? 'stale' : fresh.status === 'delayed' ? 'delayed' : stage;
  return <span className={`status ${statusClass}`}>{text}</span>;
}

function PositionList({ positions, selected, onSelect, onAdd, onChangelog, runtime }: { positions: Position[]; selected?: string; onSelect: (id: string) => void; onAdd: () => void; onChangelog: () => void; runtime: RuntimeCapabilities }) {
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark"><Activity size={19} /></div><div><strong>LP Sentinel</strong><span>Liquidity intelligence</span></div></div>
    <button className="primary add-button" onClick={onAdd}><Plus size={17} /> 按 NFT 查询</button>
    <div className="sidebar-label"><span>监控仓位</span><b>{positions.length}</b></div>
    <div className="position-list">
      {positions.length === 0 && <div className="sidebar-empty">尚无仓位<br />从 NFT ID 开始</div>}
      {positions.map((position) => <button key={position.id} className={`position-item ${position.id === selected ? 'selected' : ''}`} onClick={() => onSelect(position.id)}>
        <div className="token-pair"><span>{position.token0.symbol.slice(0, 1)}</span><span>{position.token1.symbol.slice(0, 1)}</span></div>
        <div className="position-copy"><strong>{position.name}</strong><span>{position.source.networkName} · #{position.source.tokenId}</span></div><ChevronRight size={16} />
      </button>)}
    </div>
    <div className="sidebar-foot"><ShieldCheck size={16} /><div><span>{runtime.mode === 'vercel' ? '云端会话 · 浏览器本地存储' : '本地优先 · IndexedDB 存储'}<br />私钥永不离开钱包</span><button className="version-link" onClick={onChangelog}><ScrollText size={12} /> v{appVersion} · 更新日志</button></div></div>
  </aside>;
}

function ChangelogDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <div className="overlay" role="dialog" aria-modal="true" aria-label="更新日志"><div className="dialog changelog-dialog">
    <button className="icon-button dialog-close" title="关闭更新日志" onClick={onClose}><X size={19} /></button>
    <span className="eyebrow">RELEASE NOTES</span><h2>更新日志</h2>
    <div className="version-hero"><div><small>当前版本</small><strong>LP Sentinel v{appVersion}</strong></div><ScrollText size={22} /></div>
    <div className="release-list">{changelogReleases.map((release) => <article className="release-entry" key={release.version}>
      <header><h3>v{release.version}{release.version === appVersion && <span>当前</span>}</h3><time>{release.date}</time></header>
      {release.sections.map((section) => <section key={section.title}><h4>{section.title}</h4><ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul></section>)}
    </article>)}</div>
  </div></div>;
}

function PriceChannel({ position, onSave }: { position: Position; onSave: (lower: number, upper: number) => Promise<void> }) {
  const [lower, setLower] = useState(position.alertLower);
  const [upper, setUpper] = useState(position.alertUpper);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setLower(position.alertLower); setUpper(position.alertUpper); }, [position.id, position.alertLower, position.alertUpper]);
  const span = position.rangeUpper - position.rangeLower;
  const pct = (value: number) => Math.max(0, Math.min(100, ((value - position.rangeLower) / span) * 100));
  const currentPct = position.currentPrice == null ? 50 : pct(position.currentPrice);
  const fresh = priceFreshness(position.snapshot);
  const save = async () => { setSaving(true); try { await onSave(lower, upper); } finally { setSaving(false); } };
  return <section className="card channel-card">
    <div className="section-head"><div><span className="eyebrow">PRICE CHANNEL</span><h2>价格航道</h2></div><div className={`live-badge ${fresh.status}`}><i /> {fresh.label}</div></div>
    <div className="price-summary"><span>当前价格</span><strong>{number(position.currentPrice, 7)}</strong><em>{position.token1.symbol} / {position.token0.symbol}</em></div>
    <div className="channel-area">
      <div className="channel-scale"><span>LP 下界<br /><b>{number(position.rangeLower, 7)}</b></span><span>LP 上界<br /><b>{number(position.rangeUpper, 7)}</b></span></div>
      <div className="track">
        <div className="safe-track" style={{ left: `${pct(lower)}%`, right: `${100 - pct(upper)}%` }} />
        <div className="alert-pin lower" style={{ left: `${pct(lower)}%` }}><span>下限 {number(lower, 6)}</span></div>
        <div className="alert-pin upper" style={{ left: `${pct(upper)}%` }}><span>上限 {number(upper, 6)}</span></div>
        <div className="price-pin" style={{ left: `${currentPct}%` }}><span>{number(position.currentPrice, 6)}</span></div>
        <input aria-label="下限预警" type="range" min={position.rangeLower} max={position.rangeUpper} step={span / 1000} value={lower} onChange={(e) => setLower(Math.min(Number(e.target.value), upper - span / 100))} onPointerUp={save} />
        <input aria-label="上限预警" type="range" min={position.rangeLower} max={position.rangeUpper} step={span / 1000} value={upper} onChange={(e) => setUpper(Math.max(Number(e.target.value), lower + span / 100))} onPointerUp={save} />
      </div>
      <p className="channel-hint">拖动红色预警线调整阈值，松开后保存{saving ? ' · 保存中…' : ''}</p>
    </div>
  </section>;
}

function Metrics({ position }: { position: Position }) {
  const snapshot = position.snapshot;
  const fresh = priceFreshness(snapshot);
  const apr = position.feeApr1h;
  return <div className="metrics-grid">
    <div className="metric card"><div className="metric-icon green"><CircleDollarSign size={18} /></div><span>仓位总价值</span><strong>{number(snapshot?.totalValueQuote, 2)} <small>{position.token1.symbol}</small></strong><em>{fresh.stale ? '最后已知值' : '本金 + 未领取手续费'}</em></div>
    <div className="metric card"><div className="metric-icon blue"><Zap size={18} /></div><span>未领取手续费</span><strong>{number(snapshot?.feeValueQuote, 4)} <small>{position.token1.symbol}</small></strong><em>{formatTokenAmount(snapshot?.feeAmount0 || 0)} {position.token0.symbol} + {formatTokenAmount(snapshot?.feeAmount1 || 0)} {position.token1.symbol}</em></div>
    <div className="metric card"><div className="metric-icon amber"><Gauge size={18} /></div><span>1 小时手续费 APR</span><strong>{apr ? `${number(apr.annualizedPercent, 2)}%` : '采样中'}</strong><em>{apr ? (apr.fullWindow ? '完整 1 小时窗口' : `已覆盖 ${Math.floor(apr.windowSeconds / 60)} 分钟`) : '至少需要连续 2 个快照'}</em></div>
    <div className="metric card"><div className="metric-icon violet"><Activity size={18} /></div><span>链上快照</span><strong>#{snapshot?.blockNumber || '—'}</strong><em className={fresh.stale ? 'danger-text' : ''}>{position.lastError || fresh.label}</em></div>
  </div>;
}

function Holdings({ position }: { position: Position }) {
  const snap = position.snapshot;
  const total = (snap?.amount0 || 0) * (position.currentPrice || 0) + (snap?.amount1 || 0);
  const share0 = total ? ((snap?.amount0 || 0) * (position.currentPrice || 0)) / total * 100 : 0;
  return <section className="card holdings"><div className="section-head"><div><span className="eyebrow">ONCHAIN POSITION</span><h2>链上持仓构成</h2></div><a href={position.source.explorerUrl} target="_blank" rel="noreferrer">浏览器 <ExternalLink size={14} /></a></div>
    <div className="composition"><div style={{ width: `${share0}%` }} /><div style={{ width: `${100 - share0}%` }} /></div>
    <div className="holding-row"><div className="coin coin-a">{position.token0.symbol.slice(0, 1)}</div><div><strong>{position.token0.symbol}</strong><span>{compactAddress(position.token0.address)}</span></div><b>{formatTokenAmount(snap?.amount0 || 0)}</b><em>{number(share0, 1)}%</em></div>
    <div className="holding-row"><div className="coin coin-b">{position.token1.symbol.slice(0, 1)}</div><div><strong>{position.token1.symbol}</strong><span>{compactAddress(position.token1.address)}</span></div><b>{formatTokenAmount(snap?.amount1 || 0)}</b><em>{number(100 - share0, 1)}%</em></div>
    <div className="snapshot-foot"><span>Owner {compactAddress(position.owner)}</span><span>Fee {(position.feeTier / 10_000).toFixed(2)}%</span><span>Tick {position.tickLower} → {position.tickUpper}</span>{snap?.blockLag != null && <span>落后 {snap.blockLag} 块</span>}</div>
  </section>;
}

function NftDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: (position: Position) => Promise<void> }) {
  const [tokenId, setTokenId] = useState('984513');
  const [result, setResult] = useState<LpLookup | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  if (!open) return null;
  const lookup = async () => { setLoading(true); setError(''); setResult(null); try { setResult(await api.lookupNft(tokenId.trim())); } catch (e) { setError((e as Error).message); } finally { setLoading(false); } };
  const add = async (match: LiveLpPosition) => { setLoading(true); setError(''); try { const position = await api.importNft(tokenId.trim(), match.source.sourceId); await onImported(position); onClose(); } catch (e) { setError((e as Error).message); } finally { setLoading(false); } };
  return <div className="overlay" role="dialog" aria-modal="true"><div className="dialog lookup-dialog">
    <button className="icon-button dialog-close" onClick={onClose}><X size={19} /></button><span className="eyebrow">MULTI-NETWORK DISCOVERY</span><h2>按 Position NFT 查询</h2><p>并行探测 Robinhood Chain 与 BNB Chain。同编号跨链命中时，由你选择正确仓位。</p>
    <div className="search-box"><Search size={19} /><span>#</span><input autoFocus value={tokenId} onChange={(e) => setTokenId(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => e.key === 'Enter' && lookup()} /><button className="primary" disabled={loading || !tokenId} onClick={lookup}>{loading ? <LoaderCircle className="spin" size={17} /> : '查询链上'}</button></div>
    {error && <div className="error-banner">{error}</div>}
    {result && <div className="lookup-results">
      {result.matches.length === 0 && <div className="result-empty">未识别到仓位。可查看下方各网络探测状态。</div>}
      {result.matches.map((match) => <div className="match-card" key={match.source.sourceId}><div><span className="network-dot" /><small>{match.source.networkName} · {match.source.protocol}</small><h3>{match.token0.symbol} / {match.token1.symbol}</h3><p>价格 {number(match.currentPrice, 7)} · 价值约 {number(match.snapshot.totalValueQuote, 2)} {match.token1.symbol}</p></div><button className="secondary" disabled={loading} onClick={() => add(match)}>采用智能值并加入预警</button></div>)}
      <div className="probes">{result.probes.map((probe) => <div key={probe.sourceId}><span className={probe.status} /> <b>{probe.networkName}</b><em>{probe.message}</em></div>)}</div>
    </div>}
    <div className="safety-note"><ShieldCheck size={18} /><span>仅执行公开 RPC 读取。不会请求签名，也不会修改链上仓位。</span></div>
  </div></div>;
}

function SettingsDialog({ settings, open, onClose, onSave, onChangelog, onAuthUpdated, auth, runtime }: { settings: Settings; open: boolean; onClose: () => void; onSave: (value: Settings) => Promise<void>; onChangelog: () => void; onAuthUpdated: (value: AppState['notification']) => void; auth: AppState['notification']; runtime: RuntimeCapabilities }) {
  const [form, setForm] = useState(settings);
  const [testStatus, setTestStatus] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  useEffect(() => setForm(settings), [settings]);
  useEffect(() => {
    if (!open || runtime.notificationProvider !== 'dws') return;
    setAuthBusy(true);
    api.notificationAuth().then(onAuthUpdated).catch((error) => setTestStatus((error as Error).message)).finally(() => setAuthBusy(false));
  }, [open, runtime.notificationProvider]);
  if (!open) return null;
  const cloudMode = runtime.mode === 'vercel';
  return <div className="overlay"><div className="dialog settings-dialog"><button className="icon-button dialog-close" onClick={onClose}><X size={19} /></button><span className="eyebrow">LOCAL SETTINGS</span><h2>监控与通知</h2>
    <label>轮询间隔（秒）<input type="number" min="5" value={form.pollIntervalMs / 1000} onChange={(e) => setForm({ ...form, pollIntervalMs: Number(e.target.value) * 1000 })} /></label>
    {cloudMode ? <div className="info-banner">DWS CLI 使用本机 OAuth 登录态，Vercel 无法继承。云端版本保留链上查询与手动刷新，不发送钉钉通知。</div> : <div className="dws-auth-card">
      <div><strong>DWS CLI OAuth</strong><span>{auth.authenticated ? `已登录${auth.user ? ` · ${auth.user}` : ''}` : auth.error || '尚未登录'}</span></div>
      <code>dws auth login</code>
      <p>请在运行 LP Sentinel 的同一用户终端执行登录；凭据由 DWS 自行保存在系统安全存储中，本应用不读取 Token。</p>
      <div className="dws-auth-actions"><button className="secondary" disabled={authBusy} onClick={async () => { setAuthBusy(true); setTestStatus(''); try { onAuthUpdated(await api.notificationAuth()); } catch (e) { setTestStatus((e as Error).message); } finally { setAuthBusy(false); } }}><RefreshCw className={authBusy ? 'spin' : ''} size={14} /> 刷新登录状态</button><button className="secondary" disabled={authBusy || !auth.authenticated} onClick={async () => { setTestStatus('发送中…'); try { await api.testNotification(); setTestStatus('测试消息已发送，请检查钉钉私聊。'); } catch (e) { setTestStatus((e as Error).message); } }}>发送测试消息</button></div>
    </div>}
    {testStatus && <div className="info-banner">{testStatus}</div>}
    <div className="toggle-row"><div><strong>钉钉普通私聊</strong><span>{cloudMode ? '云端不可用' : '使用当前 DWS 登录身份发送给自己'}</span></div><input type="checkbox" disabled={cloudMode || !runtime.notifications || !auth.authenticated} checked={form.notificationEnabled} onChange={(e) => setForm({ ...form, notificationEnabled: e.target.checked })} /></div>
    <div className="toggle-row"><div><strong>应用内 DING</strong><span>{cloudMode ? '云端不可用' : '使用当前 DWS 身份追加提醒，默认关闭'}</span></div><input type="checkbox" disabled={cloudMode || !runtime.notifications || !auth.authenticated} checked={form.dingEnabled} onChange={(e) => setForm({ ...form, dingEnabled: e.target.checked })} /></div>
    <div className="toggle-row"><div><strong>电话 DING</strong><span>{cloudMode ? '云端不可用' : '使用当前 DWS 身份；可能产生通信费用'}</span></div><input type="checkbox" disabled={cloudMode || !runtime.notifications || !auth.authenticated} checked={form.dingCallEnabled} onChange={(e) => setForm({ ...form, dingCallEnabled: e.target.checked })} /></div>
    <button className="primary wide" onClick={async () => { await onSave(form); onClose(); }}>保存设置</button>
    <button className="version-settings-link" onClick={onChangelog}><ScrollText size={14} /> LP Sentinel v{appVersion} · 查看更新日志</button>
  </div></div>;
}

function WalletDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [wallet, setWallet] = useState<Awaited<ReturnType<typeof connectPancakeWallet>>['client'] | null>(null);
  const [positions, setPositions] = useState<LiveLpPosition[]>([]);
  const [note, setNote] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  if (!open) return null;
  const connect = async () => { setBusy(true); setError(''); try { const connected = await connectPancakeWallet(); setAddress(connected.address); setWallet(connected.client); const response = await api.walletPositions(connected.address); setPositions(response.positions); setNote(response.discovery); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const remove = async (position: LiveLpPosition) => { if (!wallet || !address) return; if (!window.confirm(`确认移除 #${position.source.tokenId} 的全部流动性并领取两种代币？钱包将显示最终交易。`)) return; setBusy(true); try { const hash = await removeAllLiquidity(wallet, position, address); setNote(`交易已提交：${hash}`); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  return <div className="overlay"><div className="dialog wallet-dialog"><button className="icon-button dialog-close" onClick={onClose}><X size={19} /></button><span className="eyebrow">BNB CHAIN WALLET</span><h2>PancakeSwap V3 仓位</h2><p>只读取当前地址直接持有的 Position NFT。任何移除都先预检，再由钱包逐笔确认。</p>
    {!address && <button className="primary wide" onClick={connect} disabled={busy}><WalletCards size={18} /> {busy ? '连接中…' : '连接 Binance Wallet'}</button>}
    {address && <div className="wallet-address"><i /> {compactAddress(address)} <span>BNB Chain</span></div>}
    {error && <div className="error-banner">{error}</div>}{note && <div className="info-banner">{note}</div>}
    {positions.map((position) => <div className="wallet-position" key={position.source.tokenId}><div><small>#{position.source.tokenId}</small><strong>{position.token0.symbol} / {position.token1.symbol}</strong><span>{number(position.snapshot.totalValueQuote, 2)} {position.token1.symbol}</span></div><button className="danger-outline" disabled={busy} onClick={() => remove(position)}>全部移除并领取</button></div>)}
    <div className="safety-note amber-note"><BellRing size={18} /><span>固定 0.5% 滑点保护、20 分钟截止时间；不会自动销毁空 NFT。</span></div>
  </div></div>;
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null); const [selectedId, setSelectedId] = useState<string>(); const [error, setError] = useState(''); const [refreshing, setRefreshing] = useState(false);
  const [lookupOpen, setLookupOpen] = useState(false); const [settingsOpen, setSettingsOpen] = useState(false); const [walletOpen, setWalletOpen] = useState(false); const [changelogOpen, setChangelogOpen] = useState(false);
  const hydrated = useRef(false);
  const cloudRefreshInFlight = useRef(false);
  const load = useCallback(async () => {
    try {
      let next = await api.state();
      let stored = await positionStore.getAll();
      if (!hydrated.current && stored.length === 0 && next.positions.length > 0) {
        stored = next.positions.map(toStoredPosition);
        await positionStore.putAll(stored);
      }
      const remoteKeys = next.positions.map((position) => storedPositionKey(position.source.sourceId, position.source.tokenId)).sort();
      const localKeys = stored.map((position) => position.key).sort();
      if (!hydrated.current || remoteKeys.join('|') !== localKeys.join('|')) {
        const synced = await api.syncPositions(stored);
        next = { ...next, positions: synced.positions };
        hydrated.current = true;
      }
      const normalized = { ...next, runtime: next.runtime || localRuntime };
      await positionStore.putAll(normalized.positions.map(toStoredPosition));
      setState(normalized);
      setSelectedId((current) => current && normalized.positions.some((p) => p.id === current) ? current : normalized.positions[0]?.id);
      setError('');
    } catch (e) { setError(`本地 IndexedDB 初始化失败：${(e as Error).message}`); }
  }, []);
  useEffect(() => { void load(); const timer = window.setInterval(load, 5_000); return () => window.clearInterval(timer); }, [load]);
  useEffect(() => {
    if (state?.runtime.mode !== 'vercel' || state.positions.length === 0) return;
    const refreshCloud = async () => {
      if (cloudRefreshInFlight.current) return;
      cloudRefreshInFlight.current = true;
      try { await api.refresh(await positionStore.getAll()); await load(); }
      catch (e) { setError(`云端自动刷新失败：${(e as Error).message}`); }
      finally { cloudRefreshInFlight.current = false; }
    };
    const timer = window.setInterval(refreshCloud, Math.max(5_000, state.settings.pollIntervalMs));
    return () => window.clearInterval(timer);
  }, [load, state?.positions.length, state?.runtime.mode, state?.runtime.notifications, state?.settings.pollIntervalMs]);
  const selected = useMemo(() => state?.positions.find((item) => item.id === selectedId), [state, selectedId]);
  const selectedFreshness = priceFreshness(selected?.snapshot);
  const mutate = async (action: () => Promise<unknown>) => { try { await action(); await load(); } catch (e) { setError((e as Error).message); } };
  const mutatePosition = async (action: () => Promise<Position>) => { try { const position = await action(); await positionStore.put(toStoredPosition(position)); await load(); } catch (e) { setError((e as Error).message); } };
  const removePosition = async (position: Position) => { try { await api.remove(position.id); await positionStore.remove(storedPositionKey(position.source.sourceId, position.source.tokenId)); await load(); } catch (e) { setError((e as Error).message); } };
  if (!state) return <div className="boot"><div className="brand-mark"><Activity /></div><LoaderCircle className="spin" /><span>{error || '正在读取本地状态…'}</span></div>;
  return <div className={`app-shell ${state.runtime.mode === 'vercel' ? 'cloud-mode' : ''}`}>
    <PositionList positions={state.positions} selected={selectedId} onSelect={setSelectedId} onAdd={() => setLookupOpen(true)} onChangelog={() => setChangelogOpen(true)} runtime={state.runtime} />
    <main>
      <header><div><span className="mobile-brand">LP SENTINEL · v{appVersion}</span><h1>{selected ? selected.name : '监控控制台'}</h1>{selected && <div className="header-meta"><StatusPill position={selected} /><span>{selected.source.networkName}</span><span>{selected.source.protocol}</span><span>#{selected.source.tokenId}</span></div>}</div><div className="header-actions">
        <button className="icon-button" title="钱包" onClick={() => setWalletOpen(true)}><WalletCards size={19} /></button><button className="icon-button" title="设置" onClick={() => setSettingsOpen(true)}><SettingsIcon size={19} /></button><button className="secondary refresh-button" disabled={refreshing} onClick={async () => { setRefreshing(true); await mutate(async () => api.refresh(state.runtime.mode === 'vercel' ? await positionStore.getAll() : undefined)); setRefreshing(false); }}><RefreshCw className={refreshing ? 'spin' : ''} size={16} /> 刷新</button>
      </div></header>
      {state.runtime.mode === 'vercel' && <div className="cloud-notice"><ShieldCheck size={16} /><span>Vercel 云端会话：基础仓位保存在当前浏览器 IndexedDB；页面打开期间每 {Math.max(5, state.settings.pollIntervalMs / 1000)} 秒刷新链上快照。DWS CLI 通知仅在本地运行。</span></div>}
      {error && <div className="global-error">{error}<button onClick={() => setError('')}><X size={15} /></button></div>}
      {!selected ? <div className="empty-main"><div className="radar"><div /><div /><div /><Activity /></div><span className="eyebrow">NO POSITIONS YET</span><h2>让每一条 LP 边界都清晰可见</h2><p>输入 Position NFT ID，我们会在已支持网络中并行识别仓位，并生成智能预警线。</p><button className="primary" onClick={() => setLookupOpen(true)}><Search size={17} /> 查询第一个 NFT</button><div className="network-chips"><span>Robinhood · Uniswap V3</span><span>BNB Chain · PancakeSwap V3</span></div></div> : <div className="dashboard">
        <div className="toolbar"><div><Bell size={16} /><span>{selectedFreshness.stale ? '快照已过期，预警判断已暂停' : selected.alertState.armed ? '预警已布防' : `已触发${selected.alertState.lastBoundary === 'lower' ? '下限' : '上限'}，等待价格回归`}</span></div><div><button className="text-button" onClick={() => mutatePosition(() => api.setEnabled(selected.id, !selected.enabled))}>{selected.enabled ? <Pause size={15} /> : <Play size={15} />}{selected.enabled ? '暂停监控' : '恢复监控'}</button><button className="text-button danger-text" onClick={() => window.confirm('仅删除浏览器中的本地监控记录，链上仓位不会变化。确认删除？') && removePosition(selected)}><Trash2 size={15} /> 删除记录</button></div></div>
        <Metrics position={selected} />
        <div className="content-grid"><div><PriceChannel position={selected} onSave={(lower, upper) => mutatePosition(() => api.setAlerts(selected.id, lower, upper))} /><section className="card action-card"><div className="section-head"><div><span className="eyebrow">ACTION READINESS</span><h2>策略响应阶段</h2></div><span className="read-only"><ShieldCheck size={14} /> 决策辅助</span></div><ActionStateMachine active={deriveActionStage({ currentPrice: selected.currentPrice, rangeLower: selected.rangeLower, rangeUpper: selected.rangeUpper, alertLower: selected.alertLower, alertUpper: selected.alertUpper, alertArmed: selected.alertState.armed, stale: selectedFreshness.stale })} /></section></div><Holdings position={selected} /></div>
      </div>}
    </main>
    <NftDialog open={lookupOpen} onClose={() => setLookupOpen(false)} onImported={async (position) => { await positionStore.put(toStoredPosition(position)); await load(); }} />
    <SettingsDialog open={settingsOpen} settings={state.settings} auth={state.notification} runtime={state.runtime} onAuthUpdated={(notification) => setState((current) => current ? { ...current, notification } : current)} onClose={() => setSettingsOpen(false)} onSave={(value) => mutate(() => api.settings(value))} onChangelog={() => { setSettingsOpen(false); setChangelogOpen(true); }} />
    <WalletDialog open={walletOpen} onClose={() => setWalletOpen(false)} />
    <ChangelogDialog open={changelogOpen} onClose={() => setChangelogOpen(false)} />
  </div>;
}
