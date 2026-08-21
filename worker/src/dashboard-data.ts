import {
  loadDashboardCatalog,
  publicNodeCatalogEntry,
  publicProbeCatalogEntry,
  type DashboardCatalog,
  type NodeCatalogRow,
  type ProbeCatalogRow,
} from "./catalog";
import {
  metricSamplesRangeBindings,
  metricSamplesRangeSourceSql,
  probeSamplesRangeBindings,
  probeSamplesRangeSourceSql,
  summarizeNumbers,
  summarizeRoute,
  type ProbeSampleRow,
} from "./observability";
import type { AgentReport, Env, NodeId, Severity } from "./types";

interface LatestRow {
  node_id: NodeId;
  received_at: number;
  reported_at: number;
  source_ip: string | null;
  source_asn: number | null;
  source_country: string | null;
  source_colo: string | null;
  network_rx_rate_bps: number | null;
  network_tx_rate_bps: number | null;
  report_json: string;
}

interface ObservabilityEventRow {
  node_id: NodeId;
  severity: Severity;
  event_type: string;
  occurred_at: number;
  title: string;
  detail: string;
}

interface MetricTrendRow {
  node_id: NodeId;
  timestamp: number;
  cpu_percent: number;
  cpu_min: number;
  cpu_max: number;
  memory_used_percent: number;
  disk_used_percent: number;
  inode_used_percent: number;
  load1: number;
  network_rx_rate_bps: number | null;
  network_tx_rate_bps: number | null;
}

interface ProbeTrendRow {
  node_id: NodeId;
  probe_name: string;
  timestamp: number;
  latency_ms: number | null;
  latency_min_ms: number | null;
  latency_max_ms: number | null;
  latency_p50_ms?: number | null;
  latency_p95_ms?: number | null;
  jitter_ms: number | null;
  success_percent: number;
  successful_sample_percent: number;
  sample_failure_percent: number;
  sample_coverage_percent: number;
  rounds: number;
}

export type HistoryHours = 6 | 24 | 168 | 720 | 2160;

function maskIp(ip: string | null): string {
  if (!ip) return "未知";
  if (ip.includes(".")) {
    const parts = ip.split(".");
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.x` : "已隐藏";
  }
  const parts = ip.split(":").filter(Boolean);
  return parts.length ? `${parts.slice(0, 4).join(":")}::/64` : "已隐藏";
}

function cleanText(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.length === 0) return fallback;
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").slice(0, 180);
}

function safePercent(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function nodeMaps(catalog: DashboardCatalog): {
  byInternal: Map<string, NodeCatalogRow>;
  byPublic: Map<string, NodeCatalogRow>;
} {
  return {
    byInternal: new Map(catalog.nodes.map((node) => [node.node_id, node])),
    byPublic: new Map(catalog.nodes.map((node) => [node.public_id, node])),
  };
}

function probeMap(catalog: DashboardCatalog): Map<string, ProbeCatalogRow> {
  return new Map(catalog.probes.map((probe) => [`${probe.node_id}:${probe.probe_name}`, probe]));
}

function publicCatalog(catalog: DashboardCatalog): Record<string, unknown> {
  const nodeByInternal = new Map(catalog.nodes.map((node) => [node.node_id, node]));
  const probes = probeMap(catalog);
  return {
    nodes: catalog.nodes.map(publicNodeCatalogEntry),
    services: catalog.services.map((service) => ({
      node_id: nodeByInternal.get(service.node_id)?.public_id ?? service.node_id,
      name: service.service_name,
      label: service.display_name,
      severity: service.severity,
      order: service.display_order,
    })),
    probes: catalog.probes.map((probe) =>
      publicProbeCatalogEntry(probe, nodeByInternal.get(probe.node_id)?.public_id ?? probe.node_id),
    ),
    metrics: catalog.metrics.map((metric) => ({
      key: metric.metric_key,
      label: metric.display_name,
      unit: metric.unit,
      category: metric.category,
      warning: metric.warning_value,
      critical: metric.critical_value,
      order: metric.display_order,
      default_visible: metric.default_visible === 1,
    })),
    routes: catalog.routes.map((route) => {
      const probe = probes.get(`${route.source_node_id}:${route.probe_name}`);
      return {
        key: route.route_key,
        label: route.display_name,
        source_node_id: nodeByInternal.get(route.source_node_id)?.public_id ?? route.source_node_id,
        target_node_id: route.target_node_id
          ? nodeByInternal.get(route.target_node_id)?.public_id ?? route.target_node_id
          : null,
        target_label: route.target_label,
        probe_name: probe?.public_id ?? route.probe_name,
        kind: probe?.kind ?? "tcp",
        warning_ms: route.warning_ms,
        critical_ms: route.critical_ms,
        warning_failure_percent: probe?.warning_failure_percent ?? 0,
        critical_failure_percent: probe?.critical_failure_percent ?? 0,
        order: route.display_order,
      };
    }),
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

export async function latestDashboardData(env: Env, now: number): Promise<Record<string, unknown>> {
  const [catalog, nodeRows, operationalEvents] = await Promise.all([
    loadDashboardCatalog(env),
    env.DB.prepare(
      "SELECT node_id, received_at, reported_at, source_ip, source_asn, source_country, source_colo, " +
        "network_rx_rate_bps, network_tx_rate_bps, report_json " +
        "FROM node_latest ORDER BY node_id",
    ).all<LatestRow>(),
    env.DB.prepare(
      "SELECT node_id, severity, event_type, occurred_at, title, detail " +
        "FROM observability_events WHERE occurred_at >= ? ORDER BY occurred_at DESC LIMIT 50",
    )
      .bind(now - 24 * 60 * 60)
      .all<ObservabilityEventRow>(),
  ]);
  const { byInternal } = nodeMaps(catalog);
  const probesByKey = probeMap(catalog);
  const reports = new Map(nodeRows.results.map((row) => [row.node_id, row]));

  const nodes = catalog.nodes.map((meta) => {
    const row = reports.get(meta.node_id);
    const ageSeconds = row ? Math.max(0, now - row.received_at) : Number.MAX_SAFE_INTEGER;
    if (!row) {
      return {
        ...publicNodeCatalogEntry(meta),
        online: false,
        age_seconds: null,
        source_ip: "未知",
        source_asn: null,
        country: null,
        colo: null,
        data_error: true,
      };
    }
    let report: AgentReport | null = null;
    try {
      report = JSON.parse(row.report_json) as AgentReport;
    } catch {
      report = null;
    }
    if (!report) {
      return {
        ...publicNodeCatalogEntry(meta),
        online: false,
        age_seconds: ageSeconds,
        source_ip: maskIp(row.source_ip),
        source_asn: row.source_asn,
        country: row.source_country,
        colo: row.source_colo,
        data_error: true,
      };
    }
    const online = ageSeconds <= meta.stale_seconds;
    const memoryUsedPercent = report.system.memory_total_bytes > 0
      ? 100 - (report.system.memory_available_bytes / report.system.memory_total_bytes) * 100
      : 0;
    const swapUsedPercent = report.system.swap_total_bytes > 0
      ? (report.system.swap_used_bytes / report.system.swap_total_bytes) * 100
      : 0;
    const services = report.services
      .map((service) => {
        const serviceMeta = catalog.services.find(
          (entry) => entry.node_id === meta.node_id && entry.service_name === service.name,
        );
        return {
          name: service.name,
          label: serviceMeta?.display_name ?? service.label,
          severity: serviceMeta?.severity ?? service.severity,
          state: cleanText(service.state, "unknown"),
          order: serviceMeta?.display_order ?? 999,
        };
      })
      .sort((left, right) => left.order - right.order);
    const unhealthyService = services.find((service) => service.state !== "active");
    return {
      ...publicNodeCatalogEntry(meta),
      online,
      age_seconds: ageSeconds,
      received_at: row.received_at,
      reported_at: row.reported_at,
      source_ip: maskIp(row.source_ip),
      source_asn: row.source_asn,
      country: row.source_country,
      colo: row.source_colo,
      system: {
        hostname: cleanText(report.system.hostname, "unknown"),
        os: cleanText(report.system.os, "unknown"),
        kernel: cleanText(report.system.kernel, "unknown"),
        arch: cleanText(report.system.arch, "unknown"),
      },
      metrics: {
        cpu_percent: safePercent(report.system.cpu_percent),
        memory_used_percent: safePercent(memoryUsedPercent),
        memory_total_bytes: Math.max(0, report.system.memory_total_bytes),
        memory_available_bytes: Math.max(0, report.system.memory_available_bytes),
        swap_used_percent: safePercent(swapUsedPercent),
        swap_total_bytes: Math.max(0, report.system.swap_total_bytes),
        swap_used_bytes: Math.max(0, report.system.swap_used_bytes),
        disk_used_percent: safePercent(report.system.root_used_percent),
        disk_total_bytes: Math.max(0, report.system.root_total_bytes),
        disk_free_bytes: Math.max(0, report.system.root_free_bytes),
        inode_used_percent: safePercent(report.system.root_inode_used_percent),
        load1: Math.max(0, report.system.load1),
        load5: Math.max(0, report.system.load5),
        load15: Math.max(0, report.system.load15),
        uptime_seconds: Math.max(0, report.system.uptime_seconds),
        network_rx_bytes: Math.max(0, report.system.network_rx_bytes),
        network_tx_bytes: Math.max(0, report.system.network_tx_bytes),
        network_rx_rate_bps: row.network_rx_rate_bps ?? null,
        network_tx_rate_bps: row.network_tx_rate_bps ?? null,
        network_rx_errors: Math.max(0, report.system.network_rx_errors),
        network_tx_errors: Math.max(0, report.system.network_tx_errors),
        network_rx_drops: Math.max(0, report.system.network_rx_drops),
        network_tx_drops: Math.max(0, report.system.network_tx_drops),
      },
      services,
      service: services.length === 0
        ? { label: "未配置服务监测", state: "not-configured" }
        : {
            label: services.length === 1 ? services[0].label : `${services.length} 个服务`,
            state: unhealthyService?.state ?? "active",
          },
      probes: report.probes
        .map((probe) => {
          const probeMeta = probesByKey.get(`${meta.node_id}:${probe.name}`);
          return {
            name: probeMeta?.public_id ?? probe.name.slice(0, 80),
            label: probeMeta?.display_name ?? probe.name.slice(0, 48),
            category: probeMeta?.category ?? "other",
            kind: probeMeta?.kind ?? probe.kind,
            primary: probeMeta?.is_primary === 1,
            warning_ms: probeMeta?.warning_ms ?? null,
            critical_ms: probeMeta?.critical_ms ?? null,
            warning_failure_percent: probeMeta?.warning_failure_percent ?? 0,
            critical_failure_percent: probeMeta?.critical_failure_percent ?? 0,
            order: probeMeta?.display_order ?? 999,
            success: probe.success,
            complete: probe.complete,
            duration_ms: Math.max(0, Math.round(probe.duration_ms * 10) / 10),
            average_duration_ms: probe.average_duration_ms === undefined ? null : Math.max(0, Math.round(probe.average_duration_ms * 10) / 10),
            p95_duration_ms: probe.p95_duration_ms === undefined ? null : Math.max(0, Math.round(probe.p95_duration_ms * 10) / 10),
            min_duration_ms: probe.min_duration_ms === undefined ? null : Math.max(0, Math.round(probe.min_duration_ms * 10) / 10),
            max_duration_ms: probe.max_duration_ms === undefined ? null : Math.max(0, Math.round(probe.max_duration_ms * 10) / 10),
            range_ms: probe.range_ms === undefined ? null : Math.max(0, Math.round(probe.range_ms * 10) / 10),
            jitter_ms: probe.jitter_ms === undefined ? null : Math.max(0, Math.round(probe.jitter_ms * 10) / 10),
            samples: probe.samples,
            attempted_samples: probe.attempted_samples,
            successful_samples: probe.successful_samples,
            sample_failure_percent: safePercent(probe.sample_failure_percent),
            packet_loss_percent: probe.kind === "icmp" ? safePercent(probe.packet_loss_percent ?? probe.sample_failure_percent) : null,
            checked_at: probe.checked_at,
          };
        })
        .sort((left, right) => left.order - right.order),
      agent: {
        version: cleanText(report.agent_version, "unknown"),
        queue_depth: Math.max(0, report.agent.queue_depth),
        collect_errors: Math.max(0, report.agent.collect_errors),
        send_errors: Math.max(0, report.agent.send_errors),
        started_at: Math.max(0, report.agent.started_at),
      },
    };
  });

  const recentEvents = operationalEvents.results.map((row) => ({
      node_id: byInternal.get(row.node_id)?.public_id ?? row.node_id,
      node_label: byInternal.get(row.node_id)?.display_name ?? row.node_id,
      severity: row.severity,
      event_type: cleanText(row.event_type, "event"),
      created_at: row.occurred_at,
      telegram_sent: false,
      title: cleanText(row.title, "状态事件"),
      detail: cleanText(row.detail, "没有更多详情"),
    }))
    .sort((left, right) => right.created_at - left.created_at)
    .slice(0, 50);
  const onlineNodes = nodes.filter((node) => node.online === true).length;
  return {
    schema_version: 2,
    server_time: now,
    app_version: env.APP_VERSION,
    mode: "passive",
    shadow_until: null,
    summary: {
      online_nodes: onlineNodes,
      total_nodes: catalog.nodes.length,
      active_alerts: 0,
      pending_alerts: 0,
      p1_alerts: 0,
    },
    catalog: publicCatalog(catalog),
    nodes,
    alerts: [],
    recent_events: recentEvents,
    cadence: { resources_seconds: 60, probes_seconds: 60 },
  };
}

function historyNodeClause(nodeId: string | null, prefix = ""): { sql: string; values: string[] } {
  return nodeId ? { sql: ` AND ${prefix}node_id = ?`, values: [nodeId] } : { sql: "", values: [] };
}

function routeRecommendation(routes: Array<Record<string, unknown>>): Record<string, unknown> {
  const usable = routes.filter((route) => Number(route.rounds) >= 3 && Number(route.availability_percent) > 0);
  if (usable.length < 2) return { state: "insufficient", text: "数据量不足，暂不比较链路" };
  const ranked = [...usable].sort((left, right) => {
    const availabilityDelta = Number(right.availability_percent) - Number(left.availability_percent);
    if (Math.abs(availabilityDelta) >= 0.1) return availabilityDelta;
    const failureDelta = Number(left.sample_failure_percent ?? 100) - Number(right.sample_failure_percent ?? 100);
    if (Math.abs(failureDelta) >= 0.1) return failureDelta;
    return Number(left.latency_p95_ms ?? Number.MAX_SAFE_INTEGER) - Number(right.latency_p95_ms ?? Number.MAX_SAFE_INTEGER);
  });
  const first = ranked[0];
  const second = ranked[1];
  const p95Delta = Number(second.latency_p95_ms ?? 0) - Number(first.latency_p95_ms ?? 0);
  const availabilityDelta = Number(first.availability_percent) - Number(second.availability_percent);
  const failureDelta = Number(second.sample_failure_percent ?? 0) - Number(first.sample_failure_percent ?? 0);
  if (Math.abs(p95Delta) < 3 && Math.abs(availabilityDelta) < 0.1 && Math.abs(failureDelta) < 0.1) {
    return { state: "equivalent", text: "多条链路表现接近，均可继续观察" };
  }
  return {
    state: "preferred",
    route_key: first.key,
    text: `${String(first.label)} 近期统计更稳定；仅供手工选择参考`,
  };
}

export async function dashboardHistoryData(
  env: Env,
  now: number,
  hours: HistoryHours,
  requestedPublicNodeId: string | null = null,
): Promise<Record<string, unknown>> {
  const catalog = await loadDashboardCatalog(env);
  const { byInternal, byPublic } = nodeMaps(catalog);
  const probesByKey = probeMap(catalog);
  const selectedNode = requestedPublicNodeId ? byPublic.get(requestedPublicNodeId) ?? null : null;
  if (requestedPublicNodeId && !selectedNode) throw new Error("unknown dashboard node");
  const internalNodeId = selectedNode?.node_id ?? null;
  const outputBucket = hours <= 24 ? 300 : hours <= 720 ? 3600 : 86400;
  const since = now - hours * 60 * 60;
  const rawEnd = rawHistoryEnd(env, now);
  const metricTrendSource = metricSamplesRangeSourceSql(internalNodeId !== null);
  const metricTrendBindings = metricSamplesRangeBindings(since, rawEnd, internalNodeId);
  const probeTrendSource = probeSamplesRangeSourceSql(internalNodeId !== null);
  const probeTrendBindings = probeSamplesRangeBindings(since, rawEnd, internalNodeId);

  let metricRows: MetricTrendRow[];
  let probeRows: ProbeTrendRow[];
  if (hours < 2160) {
    const [metrics, probes] = await Promise.all([
      env.DB.prepare(
        "SELECT node_id, CAST(reported_at / ? AS INTEGER) * ? AS timestamp, " +
          "ROUND(AVG(cpu_percent), 2) AS cpu_percent, ROUND(MIN(cpu_percent), 2) AS cpu_min, " +
          "ROUND(MAX(cpu_percent), 2) AS cpu_max, ROUND(AVG(memory_used_percent), 2) AS memory_used_percent, " +
          "ROUND(AVG(disk_used_percent), 2) AS disk_used_percent, ROUND(AVG(inode_used_percent), 2) AS inode_used_percent, " +
          "ROUND(AVG(load1), 2) AS load1, ROUND(AVG(network_rx_rate_bps), 2) AS network_rx_rate_bps, " +
          "ROUND(AVG(network_tx_rate_bps), 2) AS network_tx_rate_bps " +
          "FROM " + metricTrendSource + " AS samples" +
          " GROUP BY node_id, timestamp ORDER BY timestamp, node_id",
      )
        .bind(outputBucket, outputBucket, ...metricTrendBindings)
        .all<MetricTrendRow>(),
      env.DB.prepare(
        "SELECT node_id, probe_name, CAST(checked_at / ? AS INTEGER) * ? AS timestamp, " +
          "ROUND(AVG(CASE WHEN success = 1 THEN duration_ms END), 2) AS latency_ms, " +
          "ROUND(MIN(CASE WHEN success = 1 THEN COALESCE(min_duration_ms, duration_ms) END), 2) AS latency_min_ms, " +
          "ROUND(MAX(CASE WHEN success = 1 THEN COALESCE(max_duration_ms, duration_ms) END), 2) AS latency_max_ms, " +
          "ROUND(AVG(CASE WHEN success = 1 THEN jitter_ms END), 2) AS jitter_ms, " +
          "ROUND(100.0 * SUM(success) / COUNT(*), 3) AS success_percent, " +
          "ROUND(100.0 * SUM(successful_samples) / NULLIF(SUM(attempted_samples), 0), 3) AS successful_sample_percent, " +
          "ROUND(100.0 * (SUM(attempted_samples) - SUM(successful_samples)) / " +
          "NULLIF(SUM(attempted_samples), 0), 3) AS sample_failure_percent, " +
          "ROUND(100.0 * SUM(attempted_samples) / NULLIF(SUM(samples), 0), 3) AS sample_coverage_percent, " +
          "COUNT(*) AS rounds FROM " + probeTrendSource + " AS samples" +
          " GROUP BY node_id, probe_name, timestamp ORDER BY timestamp, node_id, probe_name",
      )
        .bind(outputBucket, outputBucket, ...probeTrendBindings)
        .all<ProbeTrendRow>(),
    ]);
    metricRows = metrics.results;
    probeRows = probes.results;
  } else {
    const rollupFilter = historyNodeClause(internalNodeId);
    const [metrics, probes] = await Promise.all([
      env.DB.prepare(
        "SELECT node_id, bucket AS timestamp, " +
          "ROUND(MAX(CASE WHEN metric_key = 'cpu_percent' THEN average END), 2) AS cpu_percent, " +
          "ROUND(MAX(CASE WHEN metric_key = 'cpu_percent' THEN minimum END), 2) AS cpu_min, " +
          "ROUND(MAX(CASE WHEN metric_key = 'cpu_percent' THEN maximum END), 2) AS cpu_max, " +
          "ROUND(MAX(CASE WHEN metric_key = 'memory_used_percent' THEN average END), 2) AS memory_used_percent, " +
          "ROUND(MAX(CASE WHEN metric_key = 'disk_used_percent' THEN average END), 2) AS disk_used_percent, " +
          "ROUND(MAX(CASE WHEN metric_key = 'inode_used_percent' THEN average END), 2) AS inode_used_percent, " +
          "ROUND(MAX(CASE WHEN metric_key = 'load1' THEN average END), 2) AS load1, " +
          "ROUND(MAX(CASE WHEN metric_key = 'network_rx_rate_bps' THEN average END), 2) AS network_rx_rate_bps, " +
          "ROUND(MAX(CASE WHEN metric_key = 'network_tx_rate_bps' THEN average END), 2) AS network_tx_rate_bps " +
          "FROM metric_series_rollups WHERE resolution = 'day' AND bucket >= ?" + rollupFilter.sql +
          " GROUP BY node_id, bucket ORDER BY bucket, node_id",
      )
        .bind(since, ...rollupFilter.values)
        .all<MetricTrendRow>(),
      env.DB.prepare(
        "SELECT node_id, probe_name, bucket AS timestamp, latency_average AS latency_ms, " +
          "latency_minimum AS latency_min_ms, latency_maximum AS latency_max_ms, latency_p50 AS latency_p50_ms, " +
          "latency_p95 AS latency_p95_ms, jitter_average AS jitter_ms, " +
          "ROUND(100.0 * successes / NULLIF(rounds, 0), 3) AS success_percent, " +
          "successful_sample_percent, 100.0 - successful_sample_percent AS sample_failure_percent, " +
          "sample_coverage_percent, rounds FROM probe_series_rollups " +
          "WHERE resolution = 'day' AND bucket >= ?" + rollupFilter.sql +
          " ORDER BY bucket, node_id, probe_name",
      )
        .bind(since, ...rollupFilter.values)
        .all<ProbeTrendRow>(),
    ]);
    metricRows = metrics.results;
    probeRows = probes.results;
  }

  // Historical samples outlive their catalog entries by design. Only expose
  // samples for probes that are still enabled so removed optional checks do
  // not linger in fleet trends or node details.
  probeRows = probeRows.filter((row) => probesByKey.has(`${row.node_id}:${row.probe_name}`));

  const routeSince = Math.max(since, now - 30 * 86400);
  const routeProbeSource = probeSamplesRangeSourceSql();
  const routeSamples = await env.DB.prepare(
    "SELECT samples.node_id, samples.probe_name, samples.checked_at, samples.success, samples.duration_ms, " +
      "samples.average_duration_ms, samples.p95_duration_ms, samples.min_duration_ms, samples.max_duration_ms, " +
      "samples.range_ms, samples.jitter_ms, samples.samples, samples.attempted_samples, samples.successful_samples, " +
      "samples.sample_failure_percent, samples.packet_loss_percent, samples.complete " +
      "FROM " + routeProbeSource + " AS samples INNER JOIN business_routes AS routes " +
      "ON routes.source_node_id = samples.node_id AND routes.probe_name = samples.probe_name " +
      "WHERE routes.enabled = 1 ORDER BY samples.node_id, samples.probe_name, samples.checked_at",
  )
    .bind(...probeSamplesRangeBindings(routeSince, rawEnd))
    .all<ProbeSampleRow>();
  const routeData = catalog.routes.map((route) => {
    const rows = routeSamples.results.filter(
      (sample) => sample.node_id === route.source_node_id && sample.probe_name === route.probe_name,
    );
    const probeMeta = probesByKey.get(`${route.source_node_id}:${route.probe_name}`);
    const stats = summarizeRoute(
      rows,
      route.warning_ms,
      route.critical_ms,
      probeMeta?.warning_failure_percent ?? 0,
      probeMeta?.critical_failure_percent ?? 0,
      probeMeta?.kind ?? "tcp",
    );
    const source = byInternal.get(route.source_node_id);
    const target = route.target_node_id ? byInternal.get(route.target_node_id) : null;
    const failureCritical = (probeMeta?.critical_failure_percent ?? 0) > 0 &&
      stats.sample_failure_percent >= Number(probeMeta?.critical_failure_percent);
    const failureWarning = (probeMeta?.warning_failure_percent ?? 0) > 0 &&
      stats.sample_failure_percent >= Number(probeMeta?.warning_failure_percent);
    const state = stats.rounds === 0
      ? "unknown"
      : stats.availability_percent < 95 || failureCritical || (stats.latency_p95_ms ?? 0) >= route.critical_ms
        ? "critical"
        : stats.availability_percent < 99.9 || failureWarning || (stats.latency_p95_ms ?? 0) >= route.warning_ms
          ? "warning"
          : "healthy";
    return {
      key: route.route_key,
      label: route.display_name,
      source_node_id: source?.public_id ?? route.source_node_id,
      target_node_id: target?.public_id ?? route.target_node_id,
      probe_name: probesByKey.get(`${route.source_node_id}:${route.probe_name}`)?.public_id ?? route.probe_name,
      kind: probeMeta?.kind ?? "tcp",
      warning_failure_percent: probeMeta?.warning_failure_percent ?? 0,
      critical_failure_percent: probeMeta?.critical_failure_percent ?? 0,
      warning_ms: route.warning_ms,
      critical_ms: route.critical_ms,
      coverage_hours: Math.min(hours, 720),
      state,
      ...stats,
    };
  });

  let probeSummaries: Array<Record<string, unknown>> = [];
  if (selectedNode) {
    const summarySince = Math.max(since, now - 30 * 86400);
    const summaryProbeSource = probeSamplesRangeSourceSql(true);
    const samples = await env.DB.prepare(
      "SELECT node_id, probe_name, checked_at, success, duration_ms, average_duration_ms, p95_duration_ms, " +
        "min_duration_ms, max_duration_ms, range_ms, jitter_ms, samples, attempted_samples, successful_samples, " +
        "sample_failure_percent, packet_loss_percent, complete FROM " + summaryProbeSource +
        " AS samples ORDER BY probe_name, checked_at",
    )
      .bind(...probeSamplesRangeBindings(summarySince, rawEnd, selectedNode.node_id))
      .all<ProbeSampleRow>();
    const grouped = new Map<string, ProbeSampleRow[]>();
    for (const sample of samples.results) {
      if (!probesByKey.has(`${sample.node_id}:${sample.probe_name}`)) continue;
      const current = grouped.get(sample.probe_name) ?? [];
      current.push(sample);
      grouped.set(sample.probe_name, current);
    }
    probeSummaries = [...grouped.entries()].map(([name, rows]) => {
      const successful = rows.filter((row) => row.success === 1);
      const latency = summarizeNumbers(successful.map((row) => row.duration_ms));
      const jitter = summarizeNumbers(successful.map((row) => row.jitter_ms));
      const requestedSamples = rows.reduce((sum, row) => sum + Math.max(1, row.samples), 0);
      const totalSamples = rows.reduce((sum, row) => sum + Math.max(0, row.attempted_samples), 0);
      const successfulSamples = rows.reduce((sum, row) => sum + Math.max(0, row.successful_samples), 0);
      const meta = probesByKey.get(`${selectedNode.node_id}:${name}`);
      const failurePercent = totalSamples ? (100 * (totalSamples - successfulSamples)) / totalSamples : 100;
      return {
        node_id: selectedNode.public_id,
        probe_name: meta?.public_id ?? name,
        label: meta?.display_name ?? name,
        category: meta?.category ?? "other",
        kind: meta?.kind ?? "tcp",
        coverage_hours: Math.min(hours, 720),
        rounds: rows.length,
        availability_percent: rows.length ? (100 * successful.length) / rows.length : 0,
        successful_sample_percent: totalSamples ? (100 * successfulSamples) / totalSamples : 0,
        sample_failure_percent: failurePercent,
        sample_coverage_percent: requestedSamples ? (100 * totalSamples) / requestedSamples : 0,
        packet_loss_percent: meta?.kind === "icmp" ? failurePercent : null,
        latency_average_ms: latency?.average ?? null,
        latency_min_ms: latency?.minimum ?? null,
        latency_max_ms: latency?.maximum ?? null,
        latency_p50_ms: latency?.p50 ?? null,
        latency_p95_ms: latency?.p95 ?? null,
        jitter_average_ms: jitter?.average ?? null,
      };
    });
  }

  const operationalEvents = await env.DB.prepare(
    "SELECT node_id, severity, event_type, occurred_at, title, detail FROM observability_events " +
      "WHERE occurred_at >= ? ORDER BY occurred_at DESC LIMIT 200",
  )
    .bind(since)
    .all<ObservabilityEventRow>();
  const annotations = operationalEvents.results.map((event) => ({
      node_id: byInternal.get(event.node_id)?.public_id ?? event.node_id,
      timestamp: event.occurred_at,
      type: event.event_type,
      severity: event.severity,
      title: cleanText(event.title, "状态事件"),
      detail: cleanText(event.detail, "没有更多详情"),
    }))
    .filter((event) => !selectedNode || event.node_id === selectedNode.public_id)
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, 200);

  return {
    schema_version: 2,
    server_time: now,
    hours,
    bucket_seconds: outputBucket,
    selected_node: selectedNode?.public_id ?? null,
    catalog: publicCatalog(catalog),
    metrics: metricRows.map((row) => ({ ...row, node_id: byInternal.get(row.node_id)?.public_id ?? row.node_id })),
    probes: probeRows.map((row) => {
      const meta = probesByKey.get(`${row.node_id}:${row.probe_name}`);
      return {
        ...row,
        node_id: byInternal.get(row.node_id)?.public_id ?? row.node_id,
        probe_name: meta?.public_id ?? row.probe_name,
        label: meta?.display_name ?? row.probe_name,
        category: meta?.category ?? "other",
        kind: meta?.kind ?? "tcp",
        packet_loss_percent: meta?.kind === "icmp" ? row.sample_failure_percent : null,
        warning_ms: meta?.warning_ms ?? null,
        critical_ms: meta?.critical_ms ?? null,
        warning_failure_percent: meta?.warning_failure_percent ?? 0,
        critical_failure_percent: meta?.critical_failure_percent ?? 0,
      };
    }),
    probe_summaries: probeSummaries,
    routes: routeData,
    route_recommendation: routeRecommendation(routeData),
    annotations,
  };
}
