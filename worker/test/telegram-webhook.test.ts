import { afterEach, describe, expect, it, vi } from "vitest";
import { processTelegramWebhookUpdate, type TelegramUpdate } from "../src/telegram";
import type { Env } from "../src/types";

function webhookEnv(options: { ownerUserId?: string; bindCodeHash?: string } = {}) {
  const settings = new Map<string, string>();
  if (options.ownerUserId) settings.set("telegram_owner_user_id", options.ownerUserId);
  const prepare = vi.fn((sql: string) => ({
    bind: (...args: unknown[]) => ({
      first: async () => {
        if (!sql.startsWith("SELECT value FROM settings")) return null;
        const value = settings.get(String(args[0]));
        return value === undefined ? null : { value };
      },
      run: async () => {
        const key = String(args[0]);
        if (sql.startsWith("INSERT OR IGNORE")) {
          if (settings.has(key)) return { meta: { changes: 0 } };
          settings.set(key, sql.includes("'processed'") ? "processed" : String(args[1]));
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("DELETE FROM settings")) settings.delete(key);
        return { meta: { changes: 1 } };
      },
    }),
  }));
  return {
    env: {
      DB: { prepare },
      TELEGRAM_BOT_TOKEN: "bot-token",
      TELEGRAM_BOT_USERNAME: "example_vps_monitor_bot",
      TELEGRAM_BIND_CODE_HASH: options.bindCodeHash,
      DASHBOARD_BASE_URL: "https://monitor.example.workers.dev",
    } as unknown as Env,
    prepare,
    settings,
  };
}

function commandUpdate(updateId = 101): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: 7,
      message_thread_id: 9,
      text: "/status@example_vps_monitor_bot",
      chat: { id: -100123, type: "supergroup" },
      from: { id: 42, is_bot: false },
    },
  };
}

function privateUpdate(userId: number, text: string, updateId = 201): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: 8,
      text,
      chat: { id: userId, type: "private" },
      from: { id: userId, is_bot: false },
    },
  };
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

afterEach(() => vi.unstubAllGlobals());

describe("Telegram webhook updates", () => {
  it("replies once and deduplicates a retried update", async () => {
    const { env } = webhookEnv({ ownerUserId: "12345" });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ ok: true, result: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const handler = vi.fn(async () => "all healthy");

    const update = privateUpdate(12345, "/status@example_vps_monitor_bot", 101);
    expect(await processTelegramWebhookUpdate(env, update, 1000, handler)).toBe("replied");
    expect(await processTelegramWebhookUpdate(env, update, 1001, handler)).toBe("duplicate");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]?.[1];
    if (!request) throw new Error("missing Telegram request options");
    expect(JSON.parse(String(request.body))).toMatchObject({
      chat_id: "12345",
      text: "all healthy",
    });
  });

  it("ignores group commands because the group is no longer an authorization dependency", async () => {
    const { env } = webhookEnv({ ownerUserId: "12345" });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ ok: true, result: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await processTelegramWebhookUpdate(env, commandUpdate(), 1000, async () => "no")).toBe("ignored");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows commands from the bound owner in a private chat", async () => {
    const { env } = webhookEnv({ ownerUserId: "12345" });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ ok: true, result: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await processTelegramWebhookUpdate(env, privateUpdate(12345, "/status"), 1000, async () => "private status"),
    ).toBe("replied");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(request?.body))).toMatchObject({ chat_id: "12345", text: "private status" });
    expect(JSON.parse(String(request?.body))).not.toHaveProperty("message_thread_id");
  });

  it("silently ignores private commands from anyone except the bound owner", async () => {
    const { env } = webhookEnv({ ownerUserId: "12345" });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ ok: true, result: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await processTelegramWebhookUpdate(env, privateUpdate(99999, "/status"), 1000, async () => "no"),
    ).toBe("ignored");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("binds the first private user with the one-time code", async () => {
    const code = "bind-code-1234567890";
    const { env, settings } = webhookEnv({ bindCodeHash: await hash(code) });
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ ok: true, result: true }),
    );
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await processTelegramWebhookUpdate(env, privateUpdate(12345, `/bind ${code}`), 1000, async () => "unused"),
    ).toBe("replied");
    expect(settings.get("telegram_owner_user_id")).toBe("12345");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(request?.body))).toMatchObject({ chat_id: "12345" });
  });

  it("does not reveal whether an invalid private bind code was accepted", async () => {
    const { env, settings } = webhookEnv({ bindCodeHash: await hash("bind-code-1234567890") });
    const fetchMock = vi.fn(async () => Response.json({ ok: true, result: true }));
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await processTelegramWebhookUpdate(
        env,
        privateUpdate(12345, "/bind wrong-code-123456789"),
        1000,
        async () => "unused",
      ),
    ).toBe("ignored");
    expect(settings.has("telegram_owner_user_id")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("releases the deduplication claim when Telegram delivery fails", async () => {
    const { env } = webhookEnv({ ownerUserId: "12345" });
    const update = privateUpdate(12345, "/status", 301);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad gateway", { status: 502 })));
    await expect(processTelegramWebhookUpdate(env, update, 1000, async () => "retry")).rejects.toThrow();

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, result: true })));
    expect(await processTelegramWebhookUpdate(env, update, 1001, async () => "retry")).toBe("replied");
  });
});
