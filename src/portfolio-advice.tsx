import type { PortfolioAdvice } from "../shared/portfolio";

const actions = { hold: "维持仓位", recenter: "调整区间", reduce: "减少敞口" };

export function PortfolioAdviceView({ advice, providerLabel }: { advice: PortfolioAdvice; providerLabel: string }) {
  if (!advice.options?.conservative || !advice.options?.aggressive) return <p className="portfolio-warning" role="alert">分析服务仍在使用旧版本，请重启本地服务后重新分析。</p>;
  return <div className="portfolio-advice" aria-live="polite">
            <div className="portfolio-advice-title"><span>策略方案</span><small>{providerLabel} · {new Date(advice.createdAt).toLocaleTimeString("zh-CN")}</small></div>
            <p className="portfolio-advice-summary">{advice.summary}</p>
            <div className="portfolio-strategy-options">{([["保守方案", advice.options.conservative], ["激进方案", advice.options.aggressive]] as const).map(([label, option]) => <section className="portfolio-strategy-option" key={label}>
              <div className="portfolio-strategy-heading"><strong>{label}</strong><span>{actions[option.action]}</span></div>
              <p className="portfolio-strategy-summary">{option.summary}</p>
              <p>{option.strategy}</p>
              <p className="portfolio-strategy-trigger">何时考虑：{option.trigger}</p>
            </section>)}</div>
            <details className="portfolio-diagnostics"><summary>展开查看依据、风险与操作步骤</summary>{([["判断依据", advice.reasons], ["需要留意", advice.risks], ["操作顺序", advice.nextSteps]] as const).map(([title, lines]) => <section key={title}><h4>{title}</h4><ul>{lines.map((line, index) => <li key={index}>{line}</li>)}</ul></section>)}</details>
            <p className="portfolio-advice-snapshot">Revert · {new Date(advice.snapshot.updatedAt).toLocaleString("zh-CN", { hour12: false })} · HOLD / USD</p>
            {advice.modelUsage && <p className="portfolio-advice-snapshot">模型用量：{advice.modelUsage.inputTokens === undefined || advice.modelUsage.outputTokens === undefined ? "服务商未返回" : `输入 ${advice.modelUsage.inputTokens} / 输出 ${advice.modelUsage.outputTokens} tokens`}{advice.modelUsage.estimatedCost === undefined ? " · 费用未知" : ` · 估算 ${advice.modelUsage.currency} ${advice.modelUsage.estimatedCost.toFixed(6)}`}{advice.usageSaved === false && " · 用量未保存"}。实际费用以服务商账单为准。</p>}
          </div>;
}
