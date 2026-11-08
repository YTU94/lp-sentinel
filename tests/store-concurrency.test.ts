import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStore } from "../server/store.js";

describe("JsonStore concurrent updates", () => {
  let directory: string;

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("serializes concurrent writes without losing updates or colliding temp files", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "lp-sentinel-store-"));
    const file = path.join(directory, "data.json");
    const store = new JsonStore(file);
    await store.load();

    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) =>
      store.update((data) => { data.settings.pollIntervalSeconds += index + 1; }),
    ));

    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(store.snapshot.settings.pollIntervalSeconds).toBe(215);
    expect(JSON.parse(await readFile(file, "utf8")).settings.pollIntervalSeconds).toBe(215);
  });
});
