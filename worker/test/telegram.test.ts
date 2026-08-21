import { describe, expect, it } from "vitest";
import { parseTelegramBindCode, parseTelegramCommand } from "../src/telegram";

const bot = "@example_vps_monitor_bot";

describe("Telegram command parsing", () => {
  it("accepts status in the bound group", () => {
    expect(parseTelegramCommand("/status", bot)).toBe("status");
    expect(parseTelegramCommand("/status@example_vps_monitor_bot", bot)).toBe("status");
    expect(parseTelegramCommand("/STATUS@EXAMPLE_VPS_MONITOR_BOT", bot)).toBe("status");
  });

  it("maps help and start to the help response", () => {
    expect(parseTelegramCommand("/help", bot)).toBe("help");
    expect(parseTelegramCommand("/start@example_vps_monitor_bot", bot)).toBe("help");
  });

  it("accepts the private dashboard login command", () => {
    expect(parseTelegramCommand("/panel", bot)).toBe("panel");
    expect(parseTelegramCommand("/panel@example_vps_monitor_bot", bot)).toBe("panel");
  });

  it("allows Telegram-style command arguments", () => {
    expect(parseTelegramCommand("/status now", bot)).toBe("status");
  });

  it("ignores commands addressed to another bot or unknown commands", () => {
    expect(parseTelegramCommand("/status@another_monitor_bot", bot)).toBeNull();
    expect(parseTelegramCommand("/restart", bot)).toBeNull();
    expect(parseTelegramCommand("status", bot)).toBeNull();
  });

  it("accepts only a well-formed private binding command addressed to this bot", () => {
    expect(parseTelegramBindCode("/bind code-1234567890123456", bot)).toBe("code-1234567890123456");
    expect(parseTelegramBindCode("/bind@example_vps_monitor_bot code_1234567890123456", bot)).toBe(
      "code_1234567890123456",
    );
    expect(parseTelegramBindCode("/bind@another_monitor_bot code-1234567890123456", bot)).toBeNull();
    expect(parseTelegramBindCode("/bind short", bot)).toBeNull();
  });
});
