import { parseNodeKeys, parseRevokedNodeIds } from "./auth";
import type { Env } from "./types";

// An explicit table inventory keeps node deletion separate from shared settings,
// authentication, migrations and the database itself.
const nodeTables = [
  "alerts",
  "alert_events",
  "ip_history",
  "ingest_dedup",
  "probe_sample_dedup",
  "metric_samples_v2",
  "probe_samples_v2",
  "metric_series_rollups",
  "probe_series_rollups",
  "observability_events",
  "service_catalog",
  "node_latest",
  "snapshots",
  "metric_rollups",
  "probe_rollups",
  "probe_rounds_v3",
  "metric_samples_v3",
  "counter_catalog",
  "probe_catalog",
  "node_catalog",
] as const;
const probeTables = new Set([
  "probe_sample_dedup",
  "probe_samples_v2",
  "probe_series_rollups",
  "probe_rollups",
]);
export class NodeDeletionConflict extends Error {}

// The catalog is deleted last; all statements in the same atomic D1 batch can
// still use it to find peer-owned history without deleting other peer metrics.
function peerMatch(table: string, probeName = "probe_name"): string {
  return (
    "EXISTS (SELECT 1 FROM probe_catalog p WHERE p.target_node_id = ? " +
    "AND p.node_id = " +
    table +
    ".node_id AND p.probe_name = " +
    table +
    "." +
    probeName +
    ")"
  );
}

async function availableTables(env: Env): Promise<Set<string>> {
  const rows = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table'",
  ).all<{ name: string }>();
  return new Set(rows.results.map((row) => row.name));
}

export async function nodeDeletionSummary(env: Env, nodeId: string) {
  const available = await availableTables(env);
  const tables = nodeTables.filter((table) => available.has(table));
  const selections = tables.map(
    (table) =>
      "(SELECT COUNT(*) FROM " + table + " WHERE node_id=?) AS " + table,
  );
  if (available.has("business_routes"))
    selections.push(
      "(SELECT COUNT(*) FROM business_routes WHERE source_node_id=? OR target_node_id=?) AS business_routes",
    );
  const counts = await env.DB.prepare("SELECT " + selections.join(", "))
    .bind(
      ...tables.map(() => nodeId),
      ...(available.has("business_routes") ? [nodeId, nodeId] : []),
    )
    .first<Record<string, number>>();
  const peers = await env.DB.prepare(
    "SELECT node_id,probe_name FROM probe_catalog WHERE target_node_id=? AND node_id<>? ORDER BY node_id,probe_name",
  )
    .bind(nodeId, nodeId)
    .all<{ node_id: string; probe_name: string }>();
  return {
    node_id: nodeId,
    rows: Object.values(counts ?? {}).reduce((sum, count) => sum + count, 0),
    tables: counts ?? {},
    peers: peers.results,
  };
}

export async function permanentlyDeleteNode(env: Env, nodeId: string) {
  // Deleting data while the server still holds the credential would allow the
  // next report to recreate the node. Both credential inventories must be clean.
  if (
    Object.hasOwn(parseNodeKeys(env.NODE_KEYS), nodeId) ||
    parseRevokedNodeIds(env.REVOKED_NODE_IDS).has(nodeId)
  ) {
    throw new NodeDeletionConflict(
      "remove the node from NODE_KEYS and REVOKED_NODE_IDS first",
    );
  }
  const node = await env.DB.prepare(
    "SELECT retired_at,enabled FROM node_catalog WHERE node_id=?",
  )
    .bind(nodeId)
    .first<{ retired_at: number | null; enabled: number }>();
  if (node && node.retired_at === null && node.enabled === 1)
    throw new NodeDeletionConflict("retire the node first");
  const available = await availableTables(env);
  const before = await nodeDeletionSummary(env, nodeId);
  const statements: D1PreparedStatement[] = [];
  for (const table of ["node_latest", "snapshots"]) {
    if (!available.has(table)) continue;
    // A peer archive contains other valid probes and host metrics. Keep the
    // archive and remove only observations that refer to the deleted node.
    const match =
      "(coalesce(json_extract(q.value,'$.target_node_id'),'')=? OR EXISTS " +
      "(SELECT 1 FROM probe_catalog p WHERE p.target_node_id=? AND p.node_id=" +
      table +
      ".node_id AND p.probe_name=json_extract(q.value,'$.name')))";
    statements.push(
      env.DB.prepare(
        "UPDATE " +
          table +
          " SET report_json=json_set(report_json,'$.probes',json(" +
          "(SELECT json_group_array(json(q.value)) FROM json_each(report_json,'$.probes') q WHERE NOT " +
          match +
          "))) " +
          "WHERE node_id<>? AND json_valid(report_json) AND EXISTS(SELECT 1 FROM json_each(report_json,'$.probes') q WHERE " +
          match +
          ")",
      ).bind(nodeId, nodeId, nodeId, nodeId, nodeId),
    );
  }
  if (available.has("probe_rounds_v3")) {
    const match =
      "EXISTS(SELECT 1 FROM probe_catalog p WHERE p.target_node_id=? AND p.node_id=probe_rounds_v3.node_id " +
      "AND p.probe_name=json_extract(q.value,'$[0]'))";
    statements.push(
      env.DB.prepare(
        "UPDATE probe_rounds_v3 SET probes_json=(SELECT json_group_array(json(q.value)) FROM json_each(probes_json) q " +
          "WHERE NOT " +
          match +
          ") WHERE node_id<>? AND EXISTS(SELECT 1 FROM json_each(probes_json) q WHERE " +
          match +
          ")",
      ).bind(nodeId, nodeId, nodeId),
    );
  }
  for (const table of nodeTables) {
    if (!available.has(table)) continue;
    let where = "node_id=?";
    const bindings = [nodeId];
    if (probeTables.has(table)) {
      where += " OR " + peerMatch(table);
      bindings.push(nodeId);
    }
    if (table === "probe_catalog") {
      where += " OR target_node_id=?";
      bindings.push(nodeId);
    }
    if (table === "alerts" || table === "alert_events") {
      where +=
        " OR (json_valid(details_json) AND EXISTS(SELECT 1 FROM json_tree(details_json) d WHERE " +
        "d.key IN ('node_id','target_node_id') AND d.value=?))";
      bindings.push(nodeId);
      where +=
        " OR (json_valid(details_json) AND EXISTS(SELECT 1 FROM json_tree(details_json) d " +
        "JOIN probe_catalog p ON p.node_id=" +
        table +
        ".node_id AND p.probe_name=d.value " +
        "WHERE d.key IN ('probe_name','probe') AND p.target_node_id=?))";
      bindings.push(nodeId);
    }
    statements.push(
      env.DB.prepare("DELETE FROM " + table + " WHERE " + where).bind(
        ...bindings,
      ),
    );
  }
  if (available.has("business_routes"))
    statements.push(
      env.DB.prepare(
        "DELETE FROM business_routes WHERE source_node_id=? OR target_node_id=?",
      ).bind(nodeId, nodeId),
    );
  await env.DB.batch(statements);
  const remaining = await nodeDeletionSummary(env, nodeId);
  if (remaining.rows || remaining.peers.length)
    throw Error("node deletion verification failed");
  return {
    ok: true,
    node_id: nodeId,
    deleted: true,
    rows_removed: before.rows,
    peer_probes_removed: before.peers.length,
  };
}
