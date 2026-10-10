import {
  loadDashboardCatalog,
  publicNodeCatalogEntry,
  type DashboardCatalog,
  type NodeCatalogRow,
  type ProbeCatalogRow,
} from "./catalog";
import {
  metricSamplesRangeBindings,
  metricSamplesRangeSourceSql,
  probeSamplesRangeBindings,
  probeSamplesRangeSourceSql,
} from "./observability";
import type { AgentReport, Env, NodeId, Severity } from "./types";
import { packetLossPercent } from "./validation";

interface LatestRow {
  node_id: NodeId;
  received_at: number;
  source_country: string | null;
  network_rx_rate_bps: number | null;
  network_tx_rate_bps: number | null;
  report_json: string;
}

interface ObservabilityEventRow {
  node_id: NodeId;
  severity: Severity;
  occurred_at: number;
  title: string;
  detail: string;
}

interface MetricTrendRow {
  node_id: NodeId;
  timestamp: number;
  network_rx_rate_bps: number | null;
  network_tx_rate_bps: number | null;
}

interface ProbeTrendRow {
  node_id: NodeId;
  probe_name: string;
  timestamp: number;
  latency_ms: number | null;
  success_percent: number | null;
  loss_percent: number | null;
  attempted_samples: number | null;
  successful_samples: number | null;
  rounds: number;
}

export type HistoryHours = 6 | 24 | 168 | 720 | 2160;

export function historyBucketSeconds(hours: HistoryHours, selectedNode: boolean): number {
  if (hours <= 24) return selectedNode ? 60 : 300;
  if (hours <= 720) return 3600;
  return 86400;
}

function cleanText(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.length === 0) return fallback;
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").slice(0, 180);
}

function safePercent(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function probeMap(catalog: DashboardCatalog): Map<string, ProbeCatalogRow> {
  return new Map(catalog.probes.map((probe) => [`${probe.node_id}:${probe.probe_name}`, probe]));
}

function publicCatalog(catalog: DashboardCatalog): Record<string, unknown> {
  return {
    known_node_ids: catalog.knownNodeIds,
    nodes: catalog.nodes.map(publicNodeCatalogEntry),
  };
}

export function normalizeHistoryHours(value: string | null): HistoryHours {
  if (value === "6") return 6;
  if (value === "168") return 168;
  if (value === "720") return 720;
  if (value === "2160") return 2160;
  return 24;
}

function rawHistoryEnd(env: Env, now: number): number {
  const acceptedClockSkew = Math.max(60, Math.min(900, Number(env.REPORT_MAX_AGE_SECONDS) || 300));
  return now + acceptedClockSkew + 1;
}

function nodeSnapshot(
  meta: NodeCatalogRow,
  row: LatestRow | undefined,
  catalog: DashboardCatalog,
  probesByKey: Map<string, ProbeCatalogRow>,
  now: number,
): Record<string, unknown> {
  let report: AgentReport | null = null;
  try {
    report = row ? (JSON.parse(row.report_json) as AgentReport) : null;
  } catch {
    report = null;
  }
  if (!row || !report) {
    return { ...publicNodeCatalogEntry(meta), online: false, country: row?.source_country ?? null, data_error: true };
  }
  const memoryUsedPercent = report.system.memory_total_bytes > 0
    ? 100 - (report.system.memory_available_bytes / report.system.memory_total_bytes) * 100
    : 0;
  return {
    ...publicNodeCatalogEntry(meta),
    online: now - row.received_at <= meta.stale_seconds,
    received_at: row.received_at,
    country: row.source_country,
    system: {
      hostname: cleanText(report.system.hostname, "unknown"),
      os: cleanText(report.system.os, "unknown"),
      kernel: cleanText(report.system.kernel, "unknown"),
    },
    metrics: {
      cpu_percent: safePercent(report.system.cpu_percent),
      cpu_count: report.system.cpu_count ?? null,
      memory_used_percent: safePercent(memoryUsedPercent),
      memory_total_bytes: Math.max(0, report.system.memory_total_bytes),
      disk_used_percent: safePercent(report.system.root_used_percent),
      disk_total_bytes: Math.max(0, report.system.root_total_bytes),
      uptime_seconds: Math.max(0, report.system.uptime_seconds),
      network_interfaces: report.system.network_interfaces ?? null,
      network_valid: report.system.network_valid ?? null,
      traffic_cycle: report.system.traffic_cycle
        ? { rx_bytes: report.system.traffic_cycle.rx_bytes, tx_bytes: report.system.traffic_cycle.tx_bytes }
        : null,
      network_rx_rate_bps: row.network_rx_rate_bps ?? null,
      network_tx_rate_bps: row.network_tx_rate_bps ?? null,
    },
    services: report.services
      .map((service) => {
        const serviceMeta = catalog.services.find(
          (entry) => entry.node_id === meta.node_id && entry.service_name === service.name,
        );
        return {
          name: service.name,
          label: serviceMeta?.display_name ?? service.label,
          state: cleanText(service.state, "unknown"),
          order: serviceMeta?.display_order ?? 999,
        };
      })
      .sort((left, right) => left.order - right.order)
      .map(({ order: _order, ...service }) => service),
    probes: report.probes
      .flatMap((probe) => {
        const probeMeta = probesByKey.get(`${meta.node_id}:${probe.name}`);
        if (!probeMeta) return [];
        const icmp = probeMeta.kind === "icmp";
        return [{
          name: probeMeta.public_id,
          label: probeMeta.display_name,
          category: probeMeta.category,
          kind: probeMeta.kind,
          order: probeMeta.display_order,
          warning_ms: probeMeta.warning_ms,
          critical_ms: probeMeta.critical_ms,
          warning_failure_percent: icmp ? probeMeta.warning_failure_percent : null,
          critical_failure_percent: icmp ? probeMeta.critical_failure_percent : null,
          success: probe.success,
          complete: probe.complete,
          duration_ms: Math.max(0, Math.round(probe.duration_ms * 10) / 10),
          samples: probe.samples,
          packet_loss_percent: icmp ? safePercent(packetLossPercent(probe) ?? 100) : null,
        }];
      })
      .sort((left, right) => left.order - right.order),
  };
}

export async function latestDashboardData(env: Env, now: number): Promise<Record<string, unknown>> {
  const [catalog, nodeRows] = await Promise.all([
    loadDashboardCatalog(env),
    env.DB.prepare(
      "SELECT node_id, received_at, source_country, network_rx_rate_bps, network_tx_rate_bps, report_json " +
        "FROM node_latest ORDER BY node_id",
    ).all<LatestRow>(),
  ]);
  const probesByKey = probeMap(catalog);
  const reports = new Map(nodeRows.results.map((row) => [row.node_id, row]));
  return {
    schema_version: 2,
    server_time: now,
    catalog: publicCatalog(catalog),
    nodes: catalog.nodes.map((meta) => nodeSnapshot(meta, reports.get(meta.node_id), catalog, probesByKey, now)),
  };
}

function historyNodeClause(nodeId: string | null): { sql: string; values: string[] } {
  return nodeId ? { sql: " AND node_id = ?", values: [nodeId] } : { sql: "", values: [] };
}

export async function dashboardHistoryData(
  env: Env,
  now: number,
  hours: HistoryHours,
  requestedPublicNodeId: string | null = null,
): Promise<Record<string, unknown>> {
  const catalog = await loadDashboardCatalog(env);
  const byInternal = new Map(catalog.nodes.map((node) => [node.node_id, node]));
  const probesByKey = probeMap(catalog);
  const selectedNode = requestedPublicNodeId
    ? catalog.nodes.find((node) => node.public_id === requestedPublicNodeId) ?? null
    : null;
  if (requestedPublicNodeId && !selectedNode) throw new Error("unknown dashboard node");
  const internalNodeId = selectedNode?.node_id ?? null;
  const outputBucket = historyBucketSeconds(hours, internalNodeId !== null);
  const since = now - hours * 60 * 60;
  const rawEnd = rawHistoryEnd(env, now);

  let metricRows: MetricTrendRow[];
  let probeRows: ProbeTrendRow[];
  if (hours < 2160) {
    const [metrics, probes] = await Promise.all([
      env.DB.prepare(
        "SELECT node_id, CAST(reported_at / ? AS INTEGER) * ? AS timestamp, " +
          "ROUND(AVG(network_rx_rate_bps), 2) AS network_rx_rate_bps, " +
          "ROUND(AVG(network_tx_rate_bps), 2) AS network_tx_rate_bps " +
          "FROM " + metricSamplesRangeSourceSql(internalNodeId !== null) + " AS samples" +
          " GROUP BY node_id, timestamp ORDER BY timestamp, node_id",
      )
        .bind(outputBucket, outputBucket, ...metricSamplesRangeBindings(since, rawEnd, internalNodeId))
        .all<MetricTrendRow>(),
      env.DB.prepare(
        "SELECT node_id, probe_name, CAST(checked_at / ? AS INTEGER) * ? AS timestamp, " +
          "ROUND(AVG(CASE WHEN success = 1 THEN duration_ms END), 2) AS latency_ms, " +
          "ROUND(100.0 * SUM(success) / COUNT(*), 3) AS success_percent, " +
          "ROUND(100.0 * (SUM(attempted_samples) - SUM(successful_samples)) / " +
          "NULLIF(SUM(attempted_samples), 0), 3) AS loss_percent, " +
          "SUM(attempted_samples) AS attempted_samples, SUM(successful_samples) AS successful_samples, " +
          "COUNT(*) AS rounds FROM " + probeSamplesRangeSourceSql(internalNodeId !== null) + " AS samples" +
          " GROUP BY node_id, probe_name, timestamp ORDER BY timestamp, node_id, probe_name",
      )
        .bind(outputBucket, outputBucket, ...probeSamplesRangeBindings(since, rawEnd, internalNodeId))
        .all<ProbeTrendRow>(),
    ]);
    metricRows = metrics.results;
    probeRows = probes.results;
  } else {
    const rollupFilter = historyNodeClause(internalNodeId);
    const [metrics, probes] = await Promise.all([
      env.DB.prepare(
        "SELECT node_id, bucket AS timestamp, ROUND(network_rx_rate_bps, 2) AS network_rx_rate_bps, " +
          "ROUND(network_tx_rate_bps, 2) AS network_tx_rate_bps FROM metric_series_rollups " +
          "WHERE bucket >= ?" + rollupFilter.sql + " ORDER BY bucket, node_id",
      )
        .bind(since, ...rollupFilter.values)
        .all<MetricTrendRow>(),
      env.DB.prepare(
        "SELECT node_id, probe_name, bucket AS timestamp, latency_average AS latency_ms, " +
          "ROUND(100.0 * successes / NULLIF(rounds, 0), 3) AS success_percent, " +
          "100.0 - successful_sample_percent AS loss_percent, " +
          "NULL AS attempted_samples, NULL AS successful_samples, rounds FROM probe_series_rollups " +
          "WHERE bucket >= ?" + rollupFilter.sql + " ORDER BY bucket, node_id, probe_name",
      )
        .bind(since, ...rollupFilter.values)
        .all<ProbeTrendRow>(),
    ]);
    metricRows = metrics.results;
    probeRows = probes.results;
  }

  const events = await env.DB.prepare(
    "SELECT node_id, severity, occurred_at, title, detail FROM observability_events " +
      "WHERE occurred_at >= ?" + historyNodeClause(internalNodeId).sql + " ORDER BY occurred_at DESC LIMIT 200",
  )
    .bind(since, ...historyNodeClause(internalNodeId).values)
    .all<ObservabilityEventRow>();

  const publicNodeId = (nodeId: NodeId): string => byInternal.get(nodeId)?.public_id ?? nodeId;
  return {
    schema_version: 2,
    server_time: now,
    hours,
    selected_node: selectedNode?.public_id ?? null,
    metrics: metricRows
      .filter((row) => byInternal.has(row.node_id))
      .map((row) => ({ ...row, node_id: publicNodeId(row.node_id) })),
    // Historical samples outlive their catalog entries by design. Only expose
    // samples for probes that are still enabled so removed checks do not linger.
    probes: probeRows.flatMap((row) => {
      const meta = probesByKey.get(`${row.node_id}:${row.probe_name}`);
      if (!meta) return [];
      const { loss_percent: lossPercent, ...trend } = row;
      return [{
        ...trend,
        node_id: publicNodeId(row.node_id),
        probe_name: meta.public_id,
        packet_loss_percent: meta.kind === "icmp" ? lossPercent : null,
      }];
    }),
    annotations: events.results
      .filter((event) => byInternal.has(event.node_id))
      .map((event) => ({
        node_id: publicNodeId(event.node_id),
        timestamp: event.occurred_at,
        severity: event.severity,
        title: cleanText(event.title, "状态事件"),
        detail: cleanText(event.detail, "没有更多详情"),
      })),
  };
}
