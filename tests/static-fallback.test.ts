import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStaticApp } from "../server/http/static-app.js";

describe("production static fallback", () => {
  let directory: string;

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "lp-sentinel-static-"));
    await writeFile(path.join(directory, "index.html"), "<main>LP Sentinel</main>");
  });

  afterAll(async () => rm(directory, { recursive: true, force: true }));

  it("serves the app shell for a client-side route", async () => {
    const response = await request(createStaticApp(directory)).get("/positions/demo");
    expect(response.status).toBe(200);
    expect(response.text).toContain("LP Sentinel");
  });
});
