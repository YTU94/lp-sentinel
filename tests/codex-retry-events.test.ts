import { expect, it } from "vitest";
import { validateCodexEvents } from "../server/agent/codex-cli.js";

it("accepts a recovered connection retry only after the turn completes", () => {
  expect(() => validateCodexEvents([{ type: "error", message: "Reconnecting... 2/5 (stream disconnected before completion: Connection reset by peer)" }, { type: "turn.completed" }])).not.toThrow();
  expect(() => validateCodexEvents([{ type: "error", message: "Reconnecting... 2/5 (connection reset)" }])).toThrow();
  expect(() => validateCodexEvents([{ type: "error", message: "Authentication failed" }, { type: "turn.completed" }])).toThrow();
  expect(() => validateCodexEvents([{ type: "turn.failed" }, { type: "turn.completed" }])).toThrow();
  expect(() => validateCodexEvents([{ type: "item.completed", item: { type: "command_execution" } }, { type: "turn.completed" }])).toThrow();
});
