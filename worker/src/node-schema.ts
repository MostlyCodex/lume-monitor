import type { AgentReport, Env } from "./types";

// The retired column is confined to this storage upgrade boundary. The public
// report model, archives and current-schema writes never include it.
export function nodeCatalogStatement(
  env: Env,
  report: AgentReport,
  now: number,
  legacy = false,
): D1PreparedStatement {
  const node = report.node;
  return env.DB.prepare(
    "INSERT INTO node_catalog(" +
      (legacy ? "short_mark, " : "") +
      "node_id, public_id, display_name, role_label, group_name, region_label, stale_seconds, " +
      "display_order, color_key, offline_severity, ip_change_severity, enabled, updated_at" +
      ") VALUES (" +
      (legacy ? "?, " : "") +
      "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?) " +
      "ON CONFLICT(node_id) DO UPDATE SET display_name=excluded.display_name, " +
      "role_label=excluded.role_label, group_name=excluded.group_name, " +
      "region_label=excluded.region_label, stale_seconds=excluded.stale_seconds, display_order=excluded.display_order, " +
      "color_key=excluded.color_key, offline_severity=excluded.offline_severity, " +
      "ip_change_severity=excluded.ip_change_severity, enabled=1, updated_at=excluded.updated_at " +
      "WHERE node_catalog.display_name IS NOT excluded.display_name " +
      "OR node_catalog.role_label IS NOT excluded.role_label " +
      "OR node_catalog.group_name IS NOT excluded.group_name " +
      "OR node_catalog.region_label IS NOT excluded.region_label " +
      "OR node_catalog.stale_seconds IS NOT excluded.stale_seconds " +
      "OR node_catalog.display_order IS NOT excluded.display_order " +
      "OR node_catalog.color_key IS NOT excluded.color_key " +
      "OR node_catalog.offline_severity IS NOT excluded.offline_severity " +
      "OR node_catalog.ip_change_severity IS NOT excluded.ip_change_severity " +
      "OR node_catalog.enabled IS NOT 1",
  ).bind(
    ...(legacy ? [node.id.replace(/[^A-Za-z0-9]/g, "").slice(0, 4)] : []),
    node.id,
    node.id,
    node.display_name,
    node.role,
    node.group,
    node.region,
    node.stale_seconds,
    node.display_order,
    node.color,
    node.offline_severity,
    node.ip_change_severity,
    now,
  );
}

export async function writeReportBatch(
  env: Env,
  report: AgentReport,
  now: number,
  statements: D1PreparedStatement[],
) {
  try {
    await env.DB.batch(statements);
  } catch (error) {
    // D1 rolls back failed batches. Retry only the known old NOT NULL
    // constraint; an unrelated storage error must not be hidden.
    const message = error instanceof Error ? error.message : String(error);
    if (
      !message.includes("NOT NULL constraint failed: node_catalog.short_mark")
    )
      throw error;
    try {
      await env.DB.batch([
        nodeCatalogStatement(env, report, now, true),
        ...statements.slice(1),
      ]);
    } catch (retryError) {
      // Cleanup can finish between the failed write and its legacy retry.
      // That batch also rolls back, so retry once with the current schema.
      const retryMessage =
        retryError instanceof Error ? retryError.message : String(retryError);
      if (
        !/no (?:such )?column(?: named)?[ :]+(?:node_catalog\.)?short_mark/i.test(
          retryMessage,
        )
      )
        throw retryError;
      await env.DB.batch(statements);
    }
  }
}
