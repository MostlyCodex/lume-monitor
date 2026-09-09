import { describe, expect, it } from "vitest";
import worker from "../src/index";
import { hmacHex } from "../src/auth";
import type { Env } from "../src/types";

describe("admin adoption inventory", () => {
  const secret = "private-node-secret-".repeat(4);
  const env = {ADMIN_TOKEN:"administrator-".repeat(4), NODE_KEYS:JSON.stringify({"alpha":secret,"unreported":"b".repeat(64)}), REVOKED_NODE_IDS:'["retired"]'} as Env;
  it("refuses unauthenticated callers without listing nodes", async () => {
    const response = await worker.fetch(new Request("https://monitor.example/api/v1/admin/key-inventory"), env, {} as Parameters<typeof worker.fetch>[2]);
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("alpha");
  });
  it("returns proofs for the full key set without leaking plaintext keys", async () => {
    const response = await worker.fetch(new Request("https://monitor.example/api/v1/admin/key-inventory", {headers:{Authorization:`Bearer ${env.ADMIN_TOKEN}`}}),env, {} as Parameters<typeof worker.fetch>[2]);
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain(secret);
    expect(text).not.toContain(env.ADMIN_TOKEN);
    const inventory = JSON.parse(text);
    expect(inventory.keys.map((entry: {node_id:string})=>entry.node_id)).toEqual(["alpha","unreported"]);
    expect(inventory.keys[0].proof).toBe(await hmacHex(secret,"lume-key-inventory-v1\nalpha"));
    expect(inventory.revoked_node_ids).toEqual(["retired"]);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
