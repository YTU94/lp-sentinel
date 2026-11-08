import { describe, expect, it } from "vitest";
import { buildNotificationCommands } from "../server/services/dws-notifier.js";

describe("buildNotificationCommands", () => {
  it("always creates a direct message to the authenticated user", () => {
    const commands = buildNotificationCommands({
      userId: "309595",
      message: "ETHUSDT 触及上限",
      dingEnabled: false,
    });

    expect(commands).toEqual([
      ["chat", "message", "send", "--user", "309595", "--title", "LP Sentinel 价格预警", "--text", "ETHUSDT 触及上限", "--format", "json"],
    ]);
  });

  it("adds an app DING only when enabled and robot code exists", () => {
    const commands = buildNotificationCommands({
      userId: "309595",
      message: "ETHUSDT 触及下限",
      dingEnabled: true,
      robotCode: "robot-code",
    });

    expect(commands[1]).toEqual([
      "ding", "message", "send", "--robot-code", "robot-code", "--type", "app", "--users", "309595", "--content", "ETHUSDT 触及下限", "--format", "json",
    ]);
  });

  it("rejects DING configuration without a robot code", () => {
    expect(() => buildNotificationCommands({
      userId: "309595",
      message: "alert",
      dingEnabled: true,
    })).toThrow("DING 机器人编码未配置");
  });

  it("adds a telephone DING only after the high-priority channel is enabled", () => {
    const commands = buildNotificationCommands({
      userId: "309595",
      message: "WETH / USDG 触及上限",
      dingEnabled: false,
      dingCallEnabled: true,
      robotCode: "robot-code",
    });

    expect(commands[1]).toEqual([
      "ding", "message", "send", "--robot-code", "robot-code", "--type", "call", "--users", "309595", "--content", "WETH / USDG 触及上限", "--format", "json",
    ]);
  });
});
