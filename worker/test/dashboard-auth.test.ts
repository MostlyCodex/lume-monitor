import { describe, expect, it } from "vitest";
import { createDashboardSession, verifyDashboardSession } from "../src/dashboard-auth";

const secret = "dashboard-test-secret-".padEnd(64, "x");
const now = 1_787_084_800;

describe("dashboard sessions", () => {
  it("accepts a freshly issued signed session", async () => {
    const session = await createDashboardSession(secret, now);
    expect(await verifyDashboardSession(secret, session, now + 60)).toBe(true);
    expect(session).not.toContain(secret);
  });

  it("rejects tampering", async () => {
    const session = await createDashboardSession(secret, now);
    const tampered = `${session.slice(0, -1)}${session.endsWith("a") ? "b" : "a"}`;
    expect(await verifyDashboardSession(secret, tampered, now + 60)).toBe(false);
  });

  it("rejects expired and malformed sessions", async () => {
    const session = await createDashboardSession(secret, now);
    expect(await verifyDashboardSession(secret, session, now + 31 * 24 * 60 * 60)).toBe(false);
    expect(await verifyDashboardSession(secret, "not-a-session", now)).toBe(false);
  });
});
