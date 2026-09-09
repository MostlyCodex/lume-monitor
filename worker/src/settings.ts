import type { Env } from "./types";

export const DASHBOARD_ORIGIN_SETTING = "dashboard_origin";

export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(env: Env, key: string, value: string, now: number): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  )
    .bind(key, value, now)
    .run();
}

/**
 * Accepts only an absolute http(s) origin with no credentials, path, query or
 * fragment. The recorded value ends up in Telegram login links and in the
 * webhook URL, so anything ambiguous is rejected rather than normalized.
 */
export function normalizeOrigin(value: string | undefined | null): string | null {
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
  if (!parsed.hostname || parsed.hostname.length > 253) return null;
  return parsed.origin;
}

/**
 * The dashboard base URL is discovered from the first authenticated admin call
 * instead of being pinned at build time, so a fresh deployment never needs a
 * second `wrangler deploy` just to learn its own workers.dev hostname. The
 * `DASHBOARD_BASE_URL` var remains the fallback for deployments that never call
 * an admin endpoint, and for local test configs.
 */
export async function resolveDashboardBaseUrl(env: Env): Promise<string> {
  const stored = normalizeOrigin(await getSetting(env, DASHBOARD_ORIGIN_SETTING));
  if (stored) return stored;
  return (env.DASHBOARD_BASE_URL ?? "").replace(/\/+$/, "");
}

export async function recordDashboardOrigin(env: Env, origin: string, now: number): Promise<string | null> {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return null;
  await setSetting(env, DASHBOARD_ORIGIN_SETTING, normalized, now);
  return normalized;
}
