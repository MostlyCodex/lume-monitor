import { constantTimeEqual, hmacHex } from "./auth";
import type { Env } from "./types";

const LOGIN_TTL_SECONDS = 5 * 60;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const COOKIE_NAME = "vpsmon_session";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sessionSecret(env: Env): string {
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 32) throw new Error("dashboard session secret unavailable");
  return env.ADMIN_TOKEN;
}

export async function issueDashboardLogin(env: Env, now: number): Promise<string> {
  const token = randomToken(32);
  const tokenHash = await sha256Hex(token);
  await env.DB.prepare(
    "INSERT INTO dashboard_login_tokens(token_hash, created_at, expires_at, used_at) VALUES (?, ?, ?, NULL)",
  )
    .bind(tokenHash, now, now + LOGIN_TTL_SECONDS)
    .run();
  return token;
}

export async function consumeDashboardLogin(env: Env, token: string, now: number): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const tokenHash = await sha256Hex(token);
  const result = await env.DB.prepare(
    "UPDATE dashboard_login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at >= ?",
  )
    .bind(now, tokenHash, now)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

export async function createDashboardSession(secret: string, now: number): Promise<string> {
  const payload = `v1.${now}.${now + SESSION_TTL_SECONDS}.${randomToken(16)}`;
  const signature = await hmacHex(secret, `dashboard-session\n${payload}`);
  return `${payload}.${signature}`;
}

export async function verifyDashboardSession(secret: string, value: string, now: number): Promise<boolean> {
  const match = /^v1\.(\d{10})\.(\d{10})\.([A-Za-z0-9_-]{22})\.([a-f0-9]{64})$/i.exec(value);
  if (!match) return false;
  const issuedAt = Number(match[1]);
  const expiresAt = Number(match[2]);
  if (
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    issuedAt > now + 60 ||
    expiresAt <= now ||
    expiresAt - issuedAt !== SESSION_TTL_SECONDS
  ) {
    return false;
  }
  const payload = `v1.${match[1]}.${match[2]}.${match[3]}`;
  const expected = await hmacHex(secret, `dashboard-session\n${payload}`);
  return constantTimeEqual(expected.toLowerCase(), match[4].toLowerCase());
}

function cookieValue(request: Request, name: string): string {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return "";
}

export async function hasDashboardSession(request: Request, env: Env, now: number): Promise<boolean> {
  const value = cookieValue(request, COOKIE_NAME);
  if (!value) return false;
  try {
    return await verifyDashboardSession(sessionSecret(env), value, now);
  } catch {
    return false;
  }
}

export async function newDashboardSessionCookie(env: Env, now: number): Promise<string> {
  const value = await createDashboardSession(sessionSecret(env), now);
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearDashboardSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export async function cleanupDashboardAuth(env: Env, now: number): Promise<void> {
  await env.DB.prepare("DELETE FROM dashboard_login_tokens WHERE expires_at < ?").bind(now - 24 * 60 * 60).run();
}
