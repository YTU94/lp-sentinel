import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { collect, DAY, digest, validateDataset, type History } from "./data.js";
import { CANDIDATES, CAPITAL, compareDaily, dailyReturns, replay, SCENARIOS, type Parameters, type Replay, type Strategy } from "./replay.js";

const STRATEGIES: Strategy[] = ["static", "current", "adaptive", "hodl"];
const writeJson = (path: string, value: unknown) => writeFile(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
const date = (seconds: number) => new Date(seconds * 1000).toISOString();

function calibrate(history: History) {
  const folds = [[7 * 24, 14 * 24], [14 * 24, 21 * 24]] as const;
  const ranking = CANDIDATES.map(parameters => {
    const scenarioScores = [SCENARIOS[1], SCENARIOS[3]].map(scenario => {
      let score = 0;
      for (const [from, to] of folds) for (const { pool, bars } of history.pools) {
        const baseline = replay(pool, bars, from, to, "static", null, scenario);
        const candidate = replay(pool, bars, from, to, "adaptive", parameters, scenario);
        score += pool.weight / folds.length * (candidate.returnPct - baseline.returnPct
          - 0.25 * Math.max(0, candidate.maxDrawdownPct - baseline.maxDrawdownPct));
      }
      return { scenario: scenario.name, score };
    });
    return { parameters, score: Math.min(...scenarioScores.map(s => s.score)), scenarioScores };
  }).sort((a, b) => b.score - a.score);
  return { parameters: ranking[0].score > 0 ? ranking[0].parameters : null,
    choice: ranking[0].score > 0 ? "adaptive-candidate" : "static-fallback", ranking,
    trainingHash: digest(history.pools.map(p => ({ pool: p.pool.id, bars: p.bars.slice(0, 21 * 24) }))) };
}

function evaluate(history: History, parameters: Parameters | null) {
  return SCENARIOS.map(scenario => {
    const pools = history.pools.map(({ pool, bars }) => {
      const results = Object.fromEntries(STRATEGIES.map(strategy =>
        [strategy, replay(pool, bars, 21 * 24, 30 * 24, strategy, parameters, scenario)])) as Record<Strategy, Replay>;
      return { id: pool.id, name: pool.name, weight: pool.weight, results,
        versusStatic: compareDaily(results.adaptive.dailyReturns, results.static.dailyReturns),
        versusCurrent: compareDaily(results.adaptive.dailyReturns, results.current.dailyReturns),
        versusHold: compareDaily(results.adaptive.dailyReturns, results.hodl.dailyReturns) };
    });
    const portfolio = Object.fromEntries(STRATEGIES.map(strategy => {
      const nav = pools[0].results[strategy].nav.map((_, i) => pools.reduce((sum, p) => sum + p.weight * p.results[strategy].nav[i], 0));
      let peak = CAPITAL, maxDrawdownPct = 0;
      for (const value of nav) { peak = Math.max(peak, value); maxDrawdownPct = Math.max(maxDrawdownPct, (peak - value) / peak * 100); }
      return [strategy, { returnPct: (nav[nav.length - 1] / CAPITAL - 1) * 100, maxDrawdownPct, dailyReturns: dailyReturns(nav), nav }];
    })) as Record<Strategy, { returnPct: number; maxDrawdownPct: number; dailyReturns: number[]; nav: number[] }>;
    return { scenario, pools, portfolio,
      versusStatic: compareDaily(portfolio.adaptive.dailyReturns, portfolio.static.dailyReturns),
      versusCurrent: compareDaily(portfolio.adaptive.dailyReturns, portfolio.current.dailyReturns),
      versusHold: compareDaily(portfolio.adaptive.dailyReturns, portfolio.hodl.dailyReturns) };
  });
}

async function run() {
  const [command, input, output, extra] = process.argv.slice(2);
  if (!input || extra || !["collect", "train", "verify"].includes(command)) {
    throw new Error("用法：research collect <新目录> [YYYY-MM-DD结束日UTC] | research train <history.json> <新结果目录> | research verify <合成history.json> <新结果目录>");
  }
  if (command === "collect") {
    if (output && !/^\d{4}-\d{2}-\d{2}$/.test(output)) throw new Error("结束日需为 YYYY-MM-DD（UTC，不含当天）");
    const end = output ? Date.parse(`${output}T00:00:00Z`) / 1000 : undefined;
    if (output && (!Number.isFinite(end) || date(end!).slice(0, 10) !== output)) throw new Error("结束日期无效");
    const data = await collect(end);
    await mkdir(resolve(input), { recursive: false });
    await writeJson(resolve(input, "history.json"), data);
    console.log(`已保存 3 池 × 720 小时：${resolve(input, "history.json")}\nSHA256 ${digest(data)}`);
    return;
  }
  if (!output) throw new Error("必须指定新的结果目录，禁止覆盖旧实验");
  const history = validateDataset(JSON.parse(await readFile(resolve(input), "utf8")));
  const synthetic = history.dataset.kind === "synthetic-verification";
  if (synthetic !== (command === "verify")) throw new Error("train 只接受链上索引数据；合成数据只能使用 verify 演练");
  await mkdir(resolve(output), { recursive: false });
  const fitted = calibrate(history);
  const implementationHash = digest(await Promise.all(["./data.ts", "./replay.ts", "./cli.ts", "../agent/strategy.ts", "../domain/lp-math.ts"]
    .map(file => readFile(new URL(file, import.meta.url), "utf8"))));
  const calibration = {
    version: 1, status: synthetic ? "SYNTHETIC_VERIFICATION_ONLY" : "OFFLINE_CANDIDATE_ONLY",
    createdAt: new Date().toISOString(), datasetHash: history.hash, implementationHash, nodeVersion: process.version, ...fitted,
    train: { start: date(history.dataset.start), endExclusive: date(history.dataset.start + 21 * DAY),
      folds: "days 1–7 warmup; days 8–14 and 15–21 forward validation; 24 candidates, shared across pools",
      objective: "worst scenario weighted mean excess return vs static, less 0.25 × extra drawdown; half fees and higher costs" },
    holdout: { start: date(history.dataset.start + 21 * DAY), endExclusive: date(history.dataset.end) },
    livePromotion: false,
  };
  // Freeze training output before opening the held-out evaluation window.
  await writeJson(resolve(output, "calibration.json"), calibration);
  const results = evaluate(history, fitted.parameters);
  const report = {
    status: calibration.status, datasetHash: history.hash, calibrationHash: digest(calibration),
    source: { kind: history.dataset.kind, subgraphId: history.dataset.subgraphId, meta: history.dataset.meta,
      retrievedAt: history.dataset.retrievedAt, start: date(history.dataset.start), endExclusive: date(history.dataset.end) },
    capitalPerPoolQuote: CAPITAL, choice: fitted.choice, parameters: fitted.parameters,
    livePromotion: false,
    limitations: [
      "Hourly indexed data, not per-swap or exact NFT feeGrowthInside replay; no actual historical gas observations.",
      "Fees: whole-hour in-range only, end-hour active liquidity proxy, cash-valued USDC, no compounding; not a rigorous lower bound.",
      "No exact protocol fee, fee token inventory, MEV, liquidity impact, failed transaction gas or reorg replay.",
      "Three fixed Ethereum V3 pools; the two WETH pools are correlated. This is not all Uniswap networks/pools.",
      "Only 9 held-out UTC days. Portfolio daily comparisons have 9 time windows, not 27 independent pool-days.",
      "Selection uses current known pools (survivorship bias); many parameter trials remain a source of overfitting.",
      "Current-rule comparison is sampled hourly and tick-aligned; not identical to the live 5-second observer.",
      "Current rule widens very narrow positions to at least 2% half-width, matching strategyCandidates.",
      "The holdout must not be reused to tune parameters. Repeated tuning requires a new untouched future window.",
      "No live Agent settings changed. Positive modelled results do not demonstrate higher future LP win rate.",
    ], results,
  };
  await writeJson(resolve(output, "report.json"), report);
  const pct = (n: number) => `${n.toFixed(3)}%`;
  const rows = results.map(r => `| ${r.scenario.name} | ${pct(r.portfolio.static.returnPct)} | ${pct(r.portfolio.current.returnPct)} | ${pct(r.portfolio.adaptive.returnPct)} | ${pct(r.portfolio.hodl.returnPct)} | ${r.versusStatic.wins}/${r.versusStatic.windows}（平 ${r.versusStatic.ties}） | ${r.versusCurrent.wins}/${r.versusCurrent.windows}（平 ${r.versusCurrent.ties}） | ${pct(r.portfolio.adaptive.maxDrawdownPct)} |`).join("\n");
  const details = results.flatMap(r => r.pools.map(p => {
    const a = p.results.adaptive;
    return `| ${r.scenario.name} | ${p.name} | ${pct(a.returnPct)} | ${a.feesQuote.toFixed(2)} | ${a.costsQuote.toFixed(2)} | ${a.rebalances} | ${a.fullRangeHours}/${a.hours} |`;
  })).join("\n");
  const markdown = `# ${synthetic ? "合成数据流程演练——不是链上训练结果" : "Uniswap V3 离线候选评估——手续费近似"}

状态：${report.status}。没有启用实盘参数，也不能据此认定胜率提高。

数据：${report.source.start} 至 ${report.source.endExclusive}（UTC，右侧不含）。每池 720 小时；训练前 21 日，最终测试后 9 日。数据 SHA256：\`${history.hash}\`。

校准结果：${fitted.choice}；参数：\`${JSON.stringify(fitted.parameters)}\`。训练最优分数 ${fitted.ranking[0].score.toFixed(6)}，小于等于零时回退静态 LP。

每池模拟本金 10,000 USDC；组合统计以 25% / 25% / 50% 权重汇总三个独立模拟账户的净值，不是对一个 10,000 USDC 实盘账户拆仓。ETH 与稳定币各占一半，两个 ETH 池不当成独立市场。所有策略同一初始范围、币种和报价；持币基准免 LP 入退场成本。

胜率 = 扣费后每日收益率超过对照的 UTC 日数 / 9；平局计入分母但不算赢。绝对盈利日、净收益、手续费、成本、回撤、调仓与事件原因另存 JSON。日收益依连续净值切片，最终一天计退出 gas，不做每天无成本重开。

| 成本/手续费场景 | 静态 LP 收益 | 现有规则收益 | 候选收益 | 持币收益 | 胜静态日数 | 胜现有日数 | 候选回撤 |
| --- | ---: | ---: | ---: | ---: | --- | --- | ---: |
${rows}

| 场景 | 池 | 候选收益 | 估算手续费 USDC | 总成本 USDC | 调仓次数 | 整小时在区间内 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
${details}

默认成本为每次操作 gas 5 USDC、按全部本金收取 5 bps 滑点；压力场景 gas 15 USDC、10 bps。入场收 gas 与滑点，退出双币仅收 gas，调仓每次收 gas 与滑点。手续费按 100%、50%、0% 分别估算；压力场景按 50%。这些是显式假设，非历史成交报价。

主要限制：小时手续费与活跃流动性只是近似，不能精确归因假想区间；跨界小时不给手续费，其他小时也不构成严格收益下界。没有逐笔 feeGrowthInside、实际 gas、协议分成、手续费币种库存、MEV 和失败交易。只有 9 个测试日且市场相关，不报告统计显著性或年化收益。采集保留原始字段与索引区块，但未用独立归档 RPC 复核。该报告不适用于直接修改其他链上仓位策略。

复现入口见 [回测说明](${resolve("docs/lp-research.md")})。\`calibration.json\` 先于测试写盘，记录训练排序、冻结参数和训练切片摘要；\`report.json\` 保留净值、逐次调仓与全部压力场景。
`;
  await writeFile(resolve(output, "report.md"), markdown, { flag: "wx" });
  console.log(`${report.status}\n${resolve(output, "report.md")}\n${fitted.choice}；测试窗口 9 天；实盘参数未更改。`);
}

run().catch(error => { console.error(error instanceof Error ? error.message : "研究流程失败"); process.exitCode = 1; });
