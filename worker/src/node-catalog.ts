import type { AgentReport, Env } from "./types";

export function nodeCatalogStatement(
  env: Env,
  report: AgentReport,
  now: number,
): D1PreparedStatement {
  const node = report.node;
  return env.DB.prepare(
    "INSERT INTO node_catalog(" +
      "node_id, public_id, display_name, role_label, region_label, stale_seconds, display_order, enabled, updated_at" +
      ") VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) " +
      "ON CONFLICT(node_id) DO UPDATE SET display_name=excluded.display_name, role_label=excluded.role_label, " +
      "region_label=excluded.region_label, stale_seconds=excluded.stale_seconds, display_order=excluded.display_order, " +
      "enabled=1, updated_at=excluded.updated_at " +
      "WHERE node_catalog.display_name IS NOT excluded.display_name " +
      "OR node_catalog.role_label IS NOT excluded.role_label " +
      "OR node_catalog.region_label IS NOT excluded.region_label " +
      "OR node_catalog.stale_seconds IS NOT excluded.stale_seconds " +
      "OR node_catalog.display_order IS NOT excluded.display_order " +
      "OR node_catalog.enabled IS NOT 1",
  ).bind(
    node.id,
    node.id,
    node.display_name,
    node.role,
    node.region,
    node.stale_seconds,
    node.display_order,
    now,
  );
}
