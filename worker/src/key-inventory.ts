import { hmacHex, parseNodeKeys, parseRevokedNodeIds } from "./auth";
import type { Env } from "./types";

// Admin-only proofs permit adoption and conflict detection without exposing keys.
export async function keyInventory(env: Env) {
  const keys = parseNodeKeys(env.NODE_KEYS);
  return {
    keys: await Promise.all(Object.entries(keys).sort(([a], [b]) => a.localeCompare(b)).map(async ([node_id, secret]) => ({
      node_id,
      proof: await hmacHex(secret, `lume-key-inventory-v1\n${node_id}`),
    }))),
    revoked_node_ids: [...parseRevokedNodeIds(env.REVOKED_NODE_IDS)].sort(),
  };
}
