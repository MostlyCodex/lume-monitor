import type { AgentReport, Env, ProbeResult } from "./types";

export interface NetworkRates {
  rxBps: number | null;
  txBps: number | null;
}

export interface NumericSummary {
  samples: number;
  average: number;
  minimum: number;
  maximum: number;
  p50: number;
  p95: number;
}

interface MetricSampleRow {
  node_id: string;
  reported_at: number;
  cpu_percent: number;
  memory_used_percent: number;
  disk_used_percent: number;
  inode_used_percent: number;
  load1: number;
  network_rx_rate_bps: number | null;
  network_tx_rate_bps: number | null;
}

export interface ProbeSampleRow {
  node_id: string;
  probe_name: string;
  checked_at: number;
  success: number;
  duration_ms: number;
  average_duration_ms: number | null;
  p95_duration_ms: number | null;
  min_duration_ms: number | null;
  max_duration_ms: number | null;
  range_ms: number | null;
  jitter_ms: number | null;
  samples: number;
  attempted_samples: number;
  successful_samples: number;
  sample_failure_percent: number;
  packet_loss_percent: number | null;
  complete: number;
}

export interface RouteAnomaly {
  timestamp: number;
  latency_ms: number | null;
  success: boolean;
  severity: "warning" | "critical";
  reason: string;
}

export interface RouteStatistics {
  rounds: number;
  successful_rounds: number;
  availability_percent: number;
  successful_sample_percent: number;
  sample_failure_percent: number;
  sample_coverage_percent: number;
  packet_loss_percent: number | null;
  sla_compliance_percent: number;
  latency_average_ms: number | null;
  latency_min_ms: number | null;
  latency_max_ms: number | null;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  jitter_average_ms: number | null;
  anomaly_limit_ms: number | null;
  anomalies: RouteAnomaly[];
}

const METRIC_KEYS: Array<{ key: string; value: (row: MetricSampleRow) => number | null }> = [
  { key: "cpu_percent", value: (row) => row.cpu_percent },
  { key: "memory_used_percent", value: (row) => row.memory_used_percent },
  { key: "disk_used_percent", value: (row) => row.disk_used_percent },
  { key: "inode_used_percent", value: (row) => row.inode_used_percent },
  { key: "load1", value: (row) => row.load1 },
  { key: "network_rx_rate_bps", value: (row) => row.network_rx_rate_bps },
  { key: "network_tx_rate_bps", value: (row) => row.network_tx_rate_bps },
];

function finite(values: Array<number | null | undefined>): number[] {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

export function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = Math.max(0, Math.min(1, percentileValue)) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function summarizeNumbers(values: Array<number | null | undefined>): NumericSummary | null {
  const usable = finite(values);
  if (usable.length === 0) return null;
  const total = usable.reduce((sum, value) => sum + value, 0);
  return {
    samples: usable.length,
    average: total / usable.length,
    minimum: Math.min(...usable),
    maximum: Math.max(...usable),
    p50: percentile(usable, 0.5),
    p95: percentile(usable, 0.95),
  };
}

export function computeNetworkRates(current: AgentReport, previous: AgentReport | null): NetworkRates {
  if (!previous || current.system.boot_id !== previous.system.boot_id) return { rxBps: null, txBps: null };
  const elapsed = current.generated_at - previous.generated_at;
  if (elapsed <= 0 || elapsed > 3600) return { rxBps: null, txBps: null };
  const rxDelta = current.system.network_rx_bytes - previous.system.network_rx_bytes;
  const txDelta = current.system.network_tx_bytes - previous.system.network_tx_bytes;
  return {
    rxBps: rxDelta >= 0 ? rxDelta / elapsed : null,
    txBps: txDelta >= 0 ? txDelta / elapsed : null,
  };
}

export function metricSampleStatement(
  env: Env,
  report: AgentReport,
  receivedAt: number,
  rates: NetworkRates,
): D1PreparedStatement {
  const memoryUsedPercent = report.system.memory_total_bytes > 0
    ? 100 - (report.system.memory_available_bytes / report.system.memory_total_bytes) * 100
    : 0;
  const swapUsedPercent = report.system.swap_total_bytes > 0
    ? (report.system.swap_used_bytes / report.system.swap_total_bytes) * 100
    : 0;
  return env.DB.prepare(
    "INSERT OR IGNORE INTO metric_samples_v2(" +
      "node_id, reported_at, received_at, boot_id, cpu_percent, memory_used_percent, " +
      "disk_used_percent, inode_used_percent, load1, load5, load15, swap_used_percent, " +
      "network_rx_bytes, network_tx_bytes, network_rx_rate_bps, network_tx_rate_bps, " +
      "network_rx_errors, network_tx_errors, network_rx_drops, network_tx_drops" +
      ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    report.node_id,
    report.generated_at,
    receivedAt,
    report.system.boot_id,
    report.system.cpu_percent,
    memoryUsedPercent,
    report.system.root_used_percent,
    report.system.root_inode_used_percent,
    report.system.load1,
    report.system.load5,
    report.system.load15,
    swapUsedPercent,
    report.system.network_rx_bytes,
    report.system.network_tx_bytes,
    rates.rxBps,
    rates.txBps,
    report.system.network_rx_errors,
    report.system.network_tx_errors,
    report.system.network_rx_drops,
    report.system.network_tx_drops,
  );
}

export function probeSampleStatement(
  env: Env,
  nodeId: string,
  probe: ProbeResult,
  receivedAt: number,
): D1PreparedStatement {
  const samples = Math.max(1, probe.samples ?? 1);
  const attemptedSamples = Math.max(0, probe.attempted_samples ?? samples);
  const successfulSamples = Math.max(0, probe.successful_samples ?? (probe.success ? 1 : 0));
  return env.DB.prepare(
    "INSERT OR IGNORE INTO probe_samples_v2(" +
      "node_id, probe_name, checked_at, received_at, success, duration_ms, average_duration_ms, p95_duration_ms, " +
      "min_duration_ms, max_duration_ms, range_ms, jitter_ms, samples, attempted_samples, successful_samples, " +
      "sample_failure_percent, packet_loss_percent, complete" +
      ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    nodeId,
    probe.name,
    probe.checked_at,
    receivedAt,
    probe.success ? 1 : 0,
    probe.duration_ms,
    probe.average_duration_ms ?? probe.duration_ms,
    probe.p95_duration_ms ?? probe.duration_ms,
    probe.min_duration_ms ?? null,
    probe.max_duration_ms ?? null,
    probe.range_ms ?? null,
    probe.jitter_ms ?? null,
    samples,
    attemptedSamples,
    successfulSamples,
    probe.sample_failure_percent,
    probe.packet_loss_percent ?? null,
    probe.complete ? 1 : 0,
  );
}

async function runBatches(env: Env, statements: D1PreparedStatement[]): Promise<void> {
  const limit = 80;
  for (let index = 0; index < statements.length; index += limit) {
    await env.DB.batch(statements.slice(index, index + limit));
  }
}

function bucketStart(timestamp: number, seconds: number): number {
  return Math.floor(timestamp / seconds) * seconds;
}

export async function compactObservabilityRange(
  env: Env,
  start: number,
  end: number,
  resolution: "hour" | "day",
): Promise<{ metricRollups: number; probeRollups: number }> {
  const seconds = resolution === "hour" ? 3600 : 86400;
  const [metricResult, probeResult] = await Promise.all([
    env.DB.prepare(
      "SELECT node_id, reported_at, cpu_percent, memory_used_percent, disk_used_percent, " +
        "inode_used_percent, load1, network_rx_rate_bps, network_tx_rate_bps " +
        "FROM metric_samples_v2 WHERE reported_at >= ? AND reported_at < ? ORDER BY node_id, reported_at",
    )
      .bind(start, end)
      .all<MetricSampleRow>(),
    env.DB.prepare(
      "SELECT node_id, probe_name, checked_at, success, duration_ms, average_duration_ms, p95_duration_ms, " +
        "min_duration_ms, max_duration_ms, range_ms, jitter_ms, samples, attempted_samples, successful_samples, " +
        "sample_failure_percent, packet_loss_percent, complete FROM probe_samples_v2 " +
        "WHERE checked_at >= ? AND checked_at < ? ORDER BY node_id, probe_name, checked_at",
    )
      .bind(start, end)
      .all<ProbeSampleRow>(),
  ]);

  const metricGroups = new Map<string, { nodeId: string; metricKey: string; bucket: number; values: number[] }>();
  for (const row of metricResult.results) {
    const bucket = bucketStart(row.reported_at, seconds);
    for (const metric of METRIC_KEYS) {
      const value = metric.value(row);
      if (value === null || !Number.isFinite(value)) continue;
      const key = `${row.node_id}\u0000${metric.key}\u0000${bucket}`;
      const group = metricGroups.get(key) ?? { nodeId: row.node_id, metricKey: metric.key, bucket, values: [] };
      group.values.push(value);
      metricGroups.set(key, group);
    }
  }

  const statements: D1PreparedStatement[] = [];
  for (const group of metricGroups.values()) {
    const summary = summarizeNumbers(group.values);
    if (!summary) continue;
    statements.push(
      env.DB.prepare(
        "INSERT INTO metric_series_rollups(node_id, metric_key, resolution, bucket, samples, average, minimum, maximum, p50, p95) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(node_id, metric_key, resolution, bucket) DO UPDATE SET " +
          "samples=excluded.samples, average=excluded.average, minimum=excluded.minimum, " +
          "maximum=excluded.maximum, p50=excluded.p50, p95=excluded.p95",
      ).bind(
        group.nodeId,
        group.metricKey,
        resolution,
        group.bucket,
        summary.samples,
        summary.average,
        summary.minimum,
        summary.maximum,
        summary.p50,
        summary.p95,
      ),
    );
  }

  const probeGroups = new Map<string, { nodeId: string; probeName: string; bucket: number; rows: ProbeSampleRow[] }>();
  for (const row of probeResult.results) {
    const bucket = bucketStart(row.checked_at, seconds);
    const key = `${row.node_id}\u0000${row.probe_name}\u0000${bucket}`;
    const group = probeGroups.get(key) ?? { nodeId: row.node_id, probeName: row.probe_name, bucket, rows: [] };
    group.rows.push(row);
    probeGroups.set(key, group);
  }
  for (const group of probeGroups.values()) {
    const successful = group.rows.filter((row) => row.success === 1);
    const latency = summarizeNumbers(successful.map((row) => row.duration_ms));
    const jitter = summarizeNumbers(successful.map((row) => row.jitter_ms));
    const requestedSamples = group.rows.reduce((sum, row) => sum + Math.max(1, row.samples), 0);
    const totalSamples = group.rows.reduce((sum, row) => sum + Math.max(0, row.attempted_samples), 0);
    const successfulSamples = group.rows.reduce((sum, row) => sum + Math.max(0, row.successful_samples), 0);
    statements.push(
      env.DB.prepare(
        "INSERT INTO probe_series_rollups(" +
          "node_id, probe_name, resolution, bucket, rounds, successes, latency_average, latency_minimum, " +
          "latency_maximum, latency_p50, latency_p95, jitter_average, jitter_maximum, successful_sample_percent, " +
          "sample_coverage_percent" +
          ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(node_id, probe_name, resolution, bucket) DO UPDATE SET " +
          "rounds=excluded.rounds, successes=excluded.successes, latency_average=excluded.latency_average, " +
          "latency_minimum=excluded.latency_minimum, latency_maximum=excluded.latency_maximum, " +
          "latency_p50=excluded.latency_p50, latency_p95=excluded.latency_p95, " +
          "jitter_average=excluded.jitter_average, jitter_maximum=excluded.jitter_maximum, " +
          "successful_sample_percent=excluded.successful_sample_percent, " +
          "sample_coverage_percent=excluded.sample_coverage_percent",
      ).bind(
        group.nodeId,
        group.probeName,
        resolution,
        group.bucket,
        group.rows.length,
        successful.length,
        latency?.average ?? null,
        latency?.minimum ?? null,
        latency?.maximum ?? null,
        latency?.p50 ?? null,
        latency?.p95 ?? null,
        jitter?.average ?? null,
        jitter?.maximum ?? null,
        totalSamples > 0 ? (100 * successfulSamples) / totalSamples : 0,
        requestedSamples > 0 ? (100 * totalSamples) / requestedSamples : 0,
      ),
    );
  }

  await runBatches(env, statements);
  return { metricRollups: metricGroups.size, probeRollups: probeGroups.size };
}

export async function compactRecentObservability(env: Env, now: number, includeDaily = false): Promise<void> {
  const hourEnd = bucketStart(now, 3600);
  await compactObservabilityRange(env, hourEnd - 3 * 3600, hourEnd, "hour");
  if (includeDaily) {
    const dayEnd = bucketStart(now, 86400);
    await compactObservabilityRange(env, dayEnd - 3 * 86400, dayEnd, "day");
  }
}

export async function rebuildObservabilityDay(
  env: Env,
  now: number,
  offsetDays: number,
): Promise<{ metricRollups: number; probeRollups: number }> {
  const currentDay = bucketStart(now, 86400);
  const start = currentDay - Math.max(0, offsetDays) * 86400;
  const end = Math.min(now + 1, start + 86400);
  const hourly = await compactObservabilityRange(env, start, end, "hour");
  const daily = await compactObservabilityRange(env, start, end, "day");
  return {
    metricRollups: hourly.metricRollups + daily.metricRollups,
    probeRollups: hourly.probeRollups + daily.probeRollups,
  };
}

export function summarizeRoute(
  rows: ProbeSampleRow[],
  warningMs: number,
  criticalMs: number,
  warningFailurePercent = 0,
  criticalFailurePercent = 0,
  probeKind: "icmp" | "tcp" | "tls" = "tcp",
): RouteStatistics {
  const successful = rows.filter((row) => row.success === 1);
  const latency = summarizeNumbers(successful.map((row) => row.duration_ms));
  const jitter = summarizeNumbers(successful.map((row) => row.jitter_ms));
  const requestedSamples = rows.reduce((sum, row) => sum + Math.max(1, row.samples), 0);
  const totalSamples = rows.reduce((sum, row) => sum + Math.max(0, row.attempted_samples), 0);
  const successfulSamples = rows.reduce((sum, row) => sum + Math.max(0, row.successful_samples), 0);
  const failurePercent = totalSamples > 0 ? 100 * (totalSamples - successfulSamples) / totalSamples : 100;
  const medianValue = latency?.p50 ?? null;
  const deviations = medianValue === null ? [] : successful.map((row) => Math.abs(row.duration_ms - medianValue));
  const mad = deviations.length ? percentile(deviations, 0.5) : 0;
  const anomalyLimit = medianValue === null
    ? null
    : Math.max(medianValue * 1.5, medianValue + 5, medianValue + 4 * mad);
  const anomalies = rows
    .filter((row) =>
      row.success !== 1 ||
      (warningFailurePercent > 0 && row.sample_failure_percent >= warningFailurePercent) ||
      (anomalyLimit !== null && row.duration_ms >= anomalyLimit)
    )
    .sort((left, right) => right.checked_at - left.checked_at)
    .slice(0, 60)
    .map<RouteAnomaly>((row) => {
      if (row.success !== 1) {
        return {
          timestamp: row.checked_at,
          latency_ms: null,
          success: false,
          severity: "critical",
          reason: probeKind === "icmp" ? "ICMP 不可达或严重丢包" : "连接失败",
        };
      }
      if (warningFailurePercent > 0 && row.sample_failure_percent >= warningFailurePercent) {
        return {
          timestamp: row.checked_at,
          latency_ms: row.duration_ms,
          success: true,
          severity: criticalFailurePercent > 0 && row.sample_failure_percent >= criticalFailurePercent
            ? "critical"
            : "warning",
          reason: `${probeKind === "icmp" ? "丢包率" : "连接失败率"} ${row.sample_failure_percent.toFixed(1)}%`,
        };
      }
      const severity = row.duration_ms >= criticalMs ? "critical" : "warning";
      return {
        timestamp: row.checked_at,
        latency_ms: row.duration_ms,
        success: true,
        severity,
        reason: row.duration_ms >= warningMs ? `超过观察阈值 ${warningMs}ms` : "显著偏离近期中位数",
      };
    });

  return {
    rounds: rows.length,
    successful_rounds: successful.length,
    availability_percent: rows.length > 0 ? (100 * successful.length) / rows.length : 0,
    successful_sample_percent: totalSamples > 0 ? (100 * successfulSamples) / totalSamples : 0,
    sample_failure_percent: failurePercent,
    sample_coverage_percent: requestedSamples > 0 ? (100 * totalSamples) / requestedSamples : 0,
    packet_loss_percent: probeKind === "icmp" ? failurePercent : null,
    sla_compliance_percent: rows.length > 0
      ? (100 * rows.filter((row) => row.success === 1 && row.duration_ms < criticalMs).length) / rows.length
      : 0,
    latency_average_ms: latency?.average ?? null,
    latency_min_ms: latency?.minimum ?? null,
    latency_max_ms: latency?.maximum ?? null,
    latency_p50_ms: latency?.p50 ?? null,
    latency_p95_ms: latency?.p95 ?? null,
    jitter_average_ms: jitter?.average ?? null,
    anomaly_limit_ms: anomalyLimit,
    anomalies,
  };
}
