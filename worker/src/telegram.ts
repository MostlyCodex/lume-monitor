import type { Env } from "./types";
import { constantTimeEqual } from "./auth";

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id?: number;
    message_thread_id?: number;
    text?: string;
    chat?: { id: number; type: string; title?: string };
    from?: { id: number; is_bot?: boolean; username?: string };
  };
  channel_post?: {
    text?: string;
    chat?: { id: number; type: string; title?: string };
  };
  my_chat_member?: {
    chat?: { id: number; type: string; title?: string };
    new_chat_member?: { status?: string };
  };
}

export type TelegramCommand = "status" | "panel" | "help";

const COMMAND_MENU_VERSION = "7";
const WEBHOOK_CONFIG_VERSION = "1";
const TELEGRAM_OWNER_SETTING = "telegram_owner_user_id";

export interface TelegramDiagnostics {
  bot_ok: boolean;
  username_matches: boolean;
  webhook_configured: boolean;
  webhook_url_matches: boolean;
  pending_update_count: number;
  last_error_date: number | null;
  last_error_message: string;
}

export type TelegramWebhookResult = "replied" | "ignored" | "duplicate";

async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function setSetting(env: Env, key: string, value: string, now: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  )
    .bind(key, value, now)
    .run();
}

async function telegramCall<T>(env: Env, method: string, payload: unknown): Promise<T> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("Telegram token is not configured");
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await response.json()) as { ok?: boolean; result?: T; description?: string };
  if (!response.ok || !data.ok) throw new Error(`Telegram ${method} failed: ${data.description ?? response.status}`);
  return data.result as T;
}

export function parseTelegramCommand(text: string | undefined, botUsername: string): TelegramCommand | null {
  if (!text) return null;
  const firstToken = text.trim().split(/\s+/, 1)[0] ?? "";
  const match = /^\/([a-z0-9_]{1,32})(?:@([a-z0-9_]{5,32}))?$/i.exec(firstToken);
  if (!match) return null;
  const expectedUsername = botUsername.replace(/^@/, "").toLowerCase();
  const addressedUsername = (match[2] ?? "").toLowerCase();
  if (addressedUsername && addressedUsername !== expectedUsername) return null;
  const command = match[1].toLowerCase();
  if (command === "status") return "status";
  if (command === "panel") return "panel";
  if (command === "help" || command === "start") return "help";
  return null;
}

export function parseTelegramBindCode(text: string | undefined, botUsername: string): string | null {
  if (!text) return null;
  const match = /^\/bind(?:@([a-z0-9_]{5,32}))?\s+([A-Za-z0-9_-]{16,128})\s*$/i.exec(text.trim());
  if (!match) return null;
  const expectedUsername = botUsername.replace(/^@/, "").toLowerCase();
  const addressedUsername = (match[1] ?? "").toLowerCase();
  if (addressedUsername && addressedUsername !== expectedUsername) return null;
  return match[2];
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sendTelegramToChat(
  env: Env,
  chatId: string,
  text: string,
  messageThreadId?: number,
): Promise<void> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: text.slice(0, 4000),
    disable_web_page_preview: true,
  };
  if (messageThreadId !== undefined) payload.message_thread_id = messageThreadId;
  await telegramCall(env, "sendMessage", payload);
}

export async function resolveTelegramOwnerUserId(env: Env): Promise<string | null> {
  const stored = await getSetting(env, TELEGRAM_OWNER_SETTING);
  return stored && /^\d{1,20}$/.test(stored) ? stored : null;
}

export async function ensureTelegramCommandMenu(env: Env, now: number): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN) return false;
  const ownerUserId = await resolveTelegramOwnerUserId(env);
  if (!ownerUserId) return false;
  const expectedConfiguration = `${COMMAND_MENU_VERSION}|${ownerUserId}`;
  const configuredVersion = await getSetting(env, "telegram_command_menu_version");
  if (configuredVersion === expectedConfiguration) return true;
  const commands = [
    { command: "status", description: "查看实时状态" },
    { command: "panel", description: "打开监控面板" },
    { command: "help", description: "查看命令说明" },
  ];
  const privateConfigured = await telegramCall<boolean>(env, "setMyCommands", {
    commands,
    scope: { type: "chat", chat_id: ownerUserId },
  });
  if (!privateConfigured) throw new Error("Telegram private setMyCommands returned false");
  await setSetting(env, "telegram_command_menu_version", expectedConfiguration, now);
  return true;
}

async function bindTelegramOwner(env: Env, ownerUserId: string, now: number): Promise<string | null> {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES (?, ?, ?)",
  )
    .bind(TELEGRAM_OWNER_SETTING, ownerUserId, now)
    .run();
  return resolveTelegramOwnerUserId(env);
}

async function claimTelegramUpdate(env: Env, updateId: number, now: number): Promise<boolean> {
  const claimed = await env.DB.prepare(
    "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES (?, 'processed', ?)",
  )
    .bind(`telegram_webhook_update:${updateId}`, now)
    .run();
  return (claimed.meta.changes ?? 0) === 1;
}

async function releaseTelegramUpdate(env: Env, updateId: number): Promise<void> {
  await env.DB.prepare("DELETE FROM settings WHERE key = ?")
    .bind(`telegram_webhook_update:${updateId}`)
    .run();
}

export async function processTelegramWebhookUpdate(
  env: Env,
  update: TelegramUpdate,
  now: number,
  handler: (command: TelegramCommand) => Promise<string>,
): Promise<TelegramWebhookResult> {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error("Telegram token is not configured");
  if (!Number.isSafeInteger(update.update_id) || update.update_id < 0) return "ignored";
  const message = update.message;
  const chat = message?.chat;
  const sender = message?.from;
  if (!message || !chat || !sender || sender.is_bot) return "ignored";

  const ownerUserId = await resolveTelegramOwnerUserId(env);
  const isBoundPrivateChat =
    chat.type === "private" &&
    ownerUserId !== null &&
    String(chat.id) === ownerUserId &&
    String(sender.id) === ownerUserId;

  if (!isBoundPrivateChat) {
    if (chat.type !== "private" || ownerUserId !== null || String(chat.id) !== String(sender.id)) {
      return "ignored";
    }
    const bindCode = parseTelegramBindCode(message.text, env.TELEGRAM_BOT_USERNAME);
    const expectedHash = (env.TELEGRAM_BIND_CODE_HASH ?? "").trim().toLowerCase();
    if (!bindCode || !/^[a-f0-9]{64}$/.test(expectedHash)) return "ignored";
    const actualHash = await sha256Hex(bindCode);
    if (!constantTimeEqual(actualHash, expectedHash)) return "ignored";
    if (!(await claimTelegramUpdate(env, update.update_id, now))) return "duplicate";
    try {
      const boundOwner = await bindTelegramOwner(env, String(sender.id), now);
      if (boundOwner !== String(sender.id)) return "ignored";
      await sendTelegramToChat(
        env,
        String(chat.id),
        "✅ 私聊绑定成功。现在可直接使用 /status、/panel 和 /help；机器人不会主动发送告警或日报。",
      );
      return "replied";
    } catch (error) {
      await releaseTelegramUpdate(env, update.update_id);
      throw error;
    }
  }

  const command = parseTelegramCommand(message.text, env.TELEGRAM_BOT_USERNAME);
  if (!command) return "ignored";
  if (!(await claimTelegramUpdate(env, update.update_id, now))) return "duplicate";
  try {
    let response: string;
    try {
      response = await handler(command);
    } catch {
      response = "⚠️ 暂时无法生成状态，请稍后重新发送 /status。";
    }
    await sendTelegramToChat(
      env,
      String(chat.id),
      response,
    );
    return "replied";
  } catch (error) {
    await releaseTelegramUpdate(env, update.update_id);
    throw error;
  }
}

function telegramWebhookUrl(env: Env): string {
  return `${env.DASHBOARD_BASE_URL.replace(/\/+$/, "")}/api/v1/telegram/webhook`;
}

export async function configureTelegramWebhook(env: Env, now: number): Promise<boolean> {
  if (!env.TELEGRAM_WEBHOOK_SECRET || env.TELEGRAM_WEBHOOK_SECRET.length < 32) {
    throw new Error("Telegram webhook secret is not configured");
  }
  const configured = await telegramCall<boolean>(env, "setWebhook", {
    url: telegramWebhookUrl(env),
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message"],
    drop_pending_updates: false,
  });
  if (!configured) throw new Error("Telegram setWebhook returned false");
  await setSetting(
    env,
    "telegram_webhook_config",
    `${WEBHOOK_CONFIG_VERSION}|${telegramWebhookUrl(env)}`,
    now,
  );
  return true;
}

export async function ensureTelegramWebhook(env: Env, now: number): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) return false;
  const expected = `${WEBHOOK_CONFIG_VERSION}|${telegramWebhookUrl(env)}`;
  if ((await getSetting(env, "telegram_webhook_config")) === expected) return true;
  return configureTelegramWebhook(env, now);
}

export async function telegramDiagnostics(env: Env): Promise<TelegramDiagnostics> {
  const me = await telegramCall<{ username?: string }>(env, "getMe", {});
  const webhook = await telegramCall<{
    url?: string;
    pending_update_count?: number;
    last_error_date?: number;
    last_error_message?: string;
  }>(env, "getWebhookInfo", {});
  const expected = env.TELEGRAM_BOT_USERNAME.replace(/^@/, "").toLowerCase();
  const actual = (me.username ?? "").toLowerCase();
  return {
    bot_ok: actual.length > 0,
    username_matches: actual === expected,
    webhook_configured: Boolean(webhook.url),
    webhook_url_matches: webhook.url === telegramWebhookUrl(env),
    pending_update_count: webhook.pending_update_count ?? 0,
    last_error_date: webhook.last_error_date ?? null,
    last_error_message: (webhook.last_error_message ?? "").slice(0, 240),
  };
}
