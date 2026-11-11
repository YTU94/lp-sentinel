import { beforeEach, describe, expect, it, vi } from "vitest";
import { syntheticPortfolio } from "../server/agent/evaluation-cases.js";
import { analyzePortfolioPosition } from "../server/agent/portfolio-analysis.js";
import { generateModelJson } from "../server/agent/model-service.js";

vi.mock("../server/agent/model-service.js", () => ({ generateModelJson: vi.fn(), modelStatus: vi.fn() }));
const option = (action: string, summary: string) => ({ action, summary, strategy: "核对实时价格与操作成本后决定。", trigger: "报价有效且用户确认时再操作。" });
const value = () => ({ summary: "出区间后比较两种处理方式。", conservative: option("hold", "观察回区间的可能"), aggressive: option("recenter", "考虑以现价重建区间"), reasons: ["当前仓位处于区间外"], risks: ["调仓可能改变资产敞口"], nextSteps: ["先核对实时价格和成本"] });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(generateModelJson).mockResolvedValue({ value: value(), usage: { provider: "codex", purpose: "portfolio", model: "test", createdAt: "2026-01-01T00:00:00Z" }, usageSaved: false } as never); });

describe("两种仓位策略", () => {
  it("返回保守与激进方向，并保留原有通知兼容字段", async () => {
    const advice = await analyzePortfolioPosition(syntheticPortfolio("outside"));
    expect(advice.options.conservative.action).toBe("hold");
    expect(advice.options.aggressive.action).toBe("recenter");
    expect(advice.action).toBe("hold");
    expect(advice.risks.join(" ")).toContain("不赚取");
  });
  it("出区间不能两个方向都只保持", async () => {
    const result = value(); result.aggressive.action = "hold";
    vi.mocked(generateModelJson).mockResolvedValueOnce({ value: result, usage: { provider: "codex" } } as never);
    await expect(analyzePortfolioPosition(syntheticPortfolio("outside"))).rejects.toThrow(/两个方向/);
  });
  it("过期价格不能生成建议", async () => {
    const position = syntheticPortfolio("outside"); position.dataStale = true;
    await expect(analyzePortfolioPosition(position)).rejects.toThrow(/过期/);
    expect(generateModelJson).not.toHaveBeenCalled();
  });
  it("普通池不允许重建区间；空仓不可提供调整方案", async () => {
    await expect(analyzePortfolioPosition(syntheticPortfolio("classic-staked"))).rejects.toThrow(/仓位类型/);
    const result = value(); result.conservative.action = "hold"; result.aggressive.action = "hold";
    vi.mocked(generateModelJson).mockResolvedValueOnce({ value: result, usage: { provider: "codex" } } as never);
    const empty = await analyzePortfolioPosition(syntheticPortfolio("empty"));
    expect(empty.options.conservative.action).toBe("hold");
    expect(empty.options.aggressive.action).toBe("hold");
    expect(empty.options.aggressive.strategy).not.toContain("重建");
  });
});
