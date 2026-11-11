import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Position } from "./domain/position.js";
import type { AgentState } from "../shared/agent.js";
import type { PortfolioWatchState } from "../shared/portfolio.js";
import type { EvaluationReport } from "../shared/evaluation.js";
import type { SampleState } from "../shared/samples.js";

export interface Settings {
  pollIntervalSeconds: number;
  dingEnabled: boolean;
  dingCallEnabled: boolean;
  dingRobotCode: string;
}

export interface AppData {
  positions: Position[];
  settings: Settings;
  agent?: AgentState;
  portfolioWatch?: PortfolioWatchState;
  evaluation?: EvaluationReport;
  samples?: SampleState;
}

const defaultData: AppData = {
  positions: [],
  settings: { pollIntervalSeconds: 5, dingEnabled: false, dingCallEnabled: false, dingRobotCode: "" },
};

export class JsonStore {
  private data: AppData = structuredClone(defaultData);
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<AppData>;
      this.data = {
        ...structuredClone(defaultData),
        ...parsed,
        settings: { ...structuredClone(defaultData.settings), ...parsed.settings },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.save();
    }
  }

  get snapshot(): AppData {
    return structuredClone(this.data);
  }

  async update(mutator: (data: AppData) => void) {
    const operation = this.writeQueue.then(async () => {
      const next = structuredClone(this.data);
      mutator(next);
      await this.save(next);
      this.data = next;
    });
    this.writeQueue = operation.catch(() => undefined);
    await operation;
  }

  private async save(data = this.data) {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    await writeFile(temp, JSON.stringify(data, null, 2));
    await rename(temp, this.filePath);
  }
}
