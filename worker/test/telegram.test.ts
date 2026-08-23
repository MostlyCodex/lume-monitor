import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureTelegramCommandMenu, parseTelegramBindCode, parseTelegramCommand } from "../src/telegram";
import type { Env } from "../src/types";

const bot = "@example_vps_monitor_bot";

afterEach(() => vi.unstubAllGlobals());

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

  it("publishes concise Chinese command descriptions for the bound private chat", async () => {
    const prepare = vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (!sql.startsWith("SELECT value FROM settings")) return null;
          return args[0] === "telegram_owner_user_id" ? { value: "12345" } : null;
        },
        run: async () => ({ meta: { changes: 1 } }),
      }),
    }));
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ ok: true, result: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      DB: { prepare },
      TELEGRAM_BOT_TOKEN: "bot-token",
    } as unknown as Env;

    expect(await ensureTelegramCommandMenu(env, 1000)).toBe(true);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(request?.body))).toMatchObject({
      commands: [
        { command: "status", description: "查看实时状态" },
        { command: "panel", description: "打开监控面板" },
        { command: "help", description: "查看命令说明" },
      ],
      scope: { type: "chat", chat_id: "12345" },
    });
  });
});
