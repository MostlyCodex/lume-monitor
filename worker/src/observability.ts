import type { AgentReport, Env, ProbeResult } from "./types";

export interface NetworkRates {
  rxBps: number | null;
  txBps: number | null;
}

interface MetricSampleRow {
  node_id: string;
  reported_at: number;
  network_rx_rate_bps: number | null;
  network_tx_rate_bps: number | null;
}

export interface ProbeSampleRow {
  node_id: string;
  probe_name: string;
  checked_at: number;
  success: number;
  duration_ms: number;
  attempted_samples: number;
  successful_samples: number;
}

const DAY_SECONDS = 86400;

function average(values: Array<number | null | undefined>): number | null {
  const usable = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

export function computeNetworkRates(current: AgentReport, previous: AgentReport | null): NetworkRates {
  if (!previous || current.system.boot_id !== previous.system.boot_id || current.system.network_valid === false || previous.system.network_valid === false ||
      (current.system.network_scope ?? "") !== (previous.system.network_scope ?? "") ||
      JSON.stringify(current.system.network_interfaces ?? []) !== JSON.stringify(previous.system.network_interfaces ?? [])) return { rxBps: null, txBps: null };
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
  return env.DB.prepare(
    "INSERT OR IGNORE INTO metric_samples(reported_at, node_id, received_at, network_rx_rate_bps, network_tx_rate_bps) " +
      "VALUES (?, ?, ?, ?, ?)",
  ).bind(report.generated_at, report.node_id, receivedAt, rates.rxBps, rates.txBps);
}

export function metricSamplesRangeSourceSql(nodeFiltered = false): string {
  const currentNodeClause = nodeFiltered ? " AND node_id = ?" : "";
  return "(" +
    "SELECT node_id, reported_at, network_rx_rate_bps, network_tx_rate_bps FROM metric_samples " +
    "WHERE reported_at >= ? AND reported_at < ?" + currentNodeClause +
    ")";
}

export function metricSamplesRangeBindings(
  start: number,
  end: number,
  nodeId: string | null = null,
): Array<number | string> {
  return nodeId === null
    ? [start, end]
    : [start, end, nodeId];
}

// One row per probe round: [name, checked_at, success, duration_ms, attempted_samples, successful_samples].
export function probeRoundStatement(
  env: Env,
  nodeId: string,
  probes: ProbeResult[],
  receivedAt: number,
): D1PreparedStatement {
  if (probes.length === 0) throw new Error("probe round must contain at least one probe");
  const roundAt = Math.max(...probes.map((probe) => probe.checked_at));
  const packed = probes.map((probe) => [
    probe.name,
    probe.checked_at,
    probe.success ? 1 : 0,
    probe.duration_ms,
    probe.attempted_samples,
    probe.successful_samples,
  ]);
  return env.DB.prepare(
    "INSERT OR IGNORE INTO probe_rounds(round_at, node_id, received_at, probes_json) VALUES (?, ?, ?, ?)",
  ).bind(roundAt, nodeId, receivedAt, JSON.stringify(packed));
}

export function probeSamplesRangeSourceSql(nodeFiltered = false): string {
  const packedNodeClause = nodeFiltered ? " AND rounds.node_id = ?" : "";
  return "(" +
    "SELECT rounds.node_id AS node_id, CAST(json_extract(sample.value, '$[0]') AS TEXT) AS probe_name, " +
      "CAST(json_extract(sample.value, '$[1]') AS INTEGER) AS checked_at, " +
      "CAST(json_extract(sample.value, '$[2]') AS INTEGER) AS success, " +
      "CAST(json_extract(sample.value, '$[3]') AS REAL) AS duration_ms, " +
      "CAST(json_extract(sample.value, '$[4]') AS INTEGER) AS attempted_samples, " +
      "CAST(json_extract(sample.value, '$[5]') AS INTEGER) AS successful_samples " +
      "FROM probe_rounds AS rounds CROSS JOIN json_each(rounds.probes_json) AS sample " +
      "WHERE rounds.round_at >= ? AND rounds.round_at < ?" + packedNodeClause +
    ")";
}

export function probeSamplesRangeBindings(
  start: number,
  end: number,
  nodeId: string | null = null,
): Array<number | string> {
  return nodeId === null
    ? [start, end]
    : [start, end, nodeId];
}

async function runBatches(env: Env, statements: D1PreparedStatement[]): Promise<void> {
  const limit = 80;
  for (let index = 0; index < statements.length; index += limit) {
    await env.DB.batch(statements.slice(index, index + limit));
  }
}

function dayStart(timestamp: number): number {
  return Math.floor(timestamp / DAY_SECONDS) * DAY_SECONDS;
}

/** Daily averages back the 90-day view, which outlives the 30 days of raw samples. */
export async function compactDailyObservability(env: Env, start: number, end: number): Promise<void> {
  const [metricResult, probeResult] = await Promise.all([
    env.DB.prepare(
      "SELECT node_id, reported_at, network_rx_rate_bps, network_tx_rate_bps FROM " +
        metricSamplesRangeSourceSql() + " AS samples ORDER BY node_id, reported_at",
    )
      .bind(...metricSamplesRangeBindings(start, end))
      .all<MetricSampleRow>(),
    env.DB.prepare(
      "SELECT node_id, probe_name, checked_at, success, duration_ms, attempted_samples, successful_samples FROM " +
        probeSamplesRangeSourceSql() + " AS samples ORDER BY node_id, probe_name, checked_at",
    )
      .bind(...probeSamplesRangeBindings(start, end))
      .all<ProbeSampleRow>(),
  ]);

  const metricGroups = new Map<string, MetricSampleRow[]>();
  for (const row of metricResult.results) {
    const key = `${row.node_id}\u0000${dayStart(row.reported_at)}`;
    metricGroups.set(key, [...(metricGroups.get(key) ?? []), row]);
  }
  // A concurrent permanent deletion may remove the catalog after these samples
  // were read. Guard the INSERT so an in-flight rebuild cannot resurrect rows.
  const statements: D1PreparedStatement[] = [];
  for (const rows of metricGroups.values()) {
    const nodeId = rows[0].node_id;
    statements.push(
      env.DB.prepare(
        "INSERT INTO metric_series_rollups(node_id, bucket, network_rx_rate_bps, network_tx_rate_bps) " +
          "SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM node_catalog WHERE node_id=?) " +
          "ON CONFLICT(node_id, bucket) DO UPDATE SET " +
          "network_rx_rate_bps=excluded.network_rx_rate_bps, network_tx_rate_bps=excluded.network_tx_rate_bps",
      ).bind(
        nodeId,
        dayStart(rows[0].reported_at),
        average(rows.map((row) => row.network_rx_rate_bps)),
        average(rows.map((row) => row.network_tx_rate_bps)),
        nodeId,
      ),
    );
  }

  const probeGroups = new Map<string, ProbeSampleRow[]>();
  for (const row of probeResult.results) {
    const key = `${row.node_id}\u0000${row.probe_name}\u0000${dayStart(row.checked_at)}`;
    probeGroups.set(key, [...(probeGroups.get(key) ?? []), row]);
  }
  for (const rows of probeGroups.values()) {
    const { node_id: nodeId, probe_name: probeName } = rows[0];
    const successful = rows.filter((row) => row.success === 1);
    const attempted = rows.reduce((sum, row) => sum + Math.max(0, row.attempted_samples), 0);
    const succeeded = rows.reduce((sum, row) => sum + Math.max(0, row.successful_samples), 0);
    statements.push(
      env.DB.prepare(
        "INSERT INTO probe_series_rollups(" +
          "node_id, probe_name, bucket, rounds, successes, latency_average, successful_sample_percent" +
          ") SELECT ?, ?, ?, ?, ?, ?, ? " +
          "WHERE EXISTS (SELECT 1 FROM probe_catalog WHERE node_id=? AND probe_name=?) " +
          "ON CONFLICT(node_id, probe_name, bucket) DO UPDATE SET " +
          "rounds=excluded.rounds, successes=excluded.successes, latency_average=excluded.latency_average, " +
          "successful_sample_percent=excluded.successful_sample_percent",
      ).bind(
        nodeId,
        probeName,
        dayStart(rows[0].checked_at),
        rows.length,
        successful.length,
        average(successful.map((row) => row.duration_ms)),
        attempted > 0 ? (100 * succeeded) / attempted : 0,
        nodeId,
        probeName,
      ),
    );
  }

  await runBatches(env, statements);
}

/** Rebuilds the three most recent complete days, so a missed run heals on the next one. */
export async function compactRecentObservability(env: Env, now: number): Promise<void> {
  const end = dayStart(now);
  await compactDailyObservability(env, end - 3 * DAY_SECONDS, end);
}
