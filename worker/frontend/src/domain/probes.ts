import type {
  EnergyBucket,
  HistorySnapshot,
  MetricKind,
  NodeSnapshot,
  Probe,
  ProbeHistoryRow,
  ServiceStatus,
  Severity,
} from "../types";
import { clamp } from "./format";

const ENERGY_SLOTS = 18;
const ENERGY_WINDOW_HOURS = 24;
const ENERGY_LOSS_WARNING_PERCENT = 2;
const ENERGY_LOSS_CRITICAL_PERCENT = 10;
const ENERGY_LOSS_BURST_PERCENT = 60;
const severityRank: Record<string, number> = { healthy: 0, warning: 1, critical: 2, offline: 3 };
export const PROBE_COLOR_VARIABLES = {
  telecom: "--probe-telecom",
  unicom: "--probe-unicom",
  mobile: "--probe-mobile",
  link: "--probe-link",
  green: "--green",
  red: "--red",
} as const;
const PROBE_COLOR_TONES = Object.keys(
  PROBE_COLOR_VARIABLES,
) as (keyof typeof PROBE_COLOR_VARIABLES)[];
export function displayProbeLabel(value: string | { label?: string }) {
  const label = typeof value === "string" ? value : value?.label;
  return String(label || "网络目标")
    .replace(/\s*·\s*ICMP\s*$/i, "")
    .trim();
}

export function allProbes(node: NodeSnapshot | null | undefined) {
  return (node?.probes || []).slice().sort((left, right) => {
    const categoryDelta =
      Number(left.category === "node-link") - Number(right.category === "node-link");
    return categoryDelta || Number(left.order || 999) - Number(right.order || 999);
  });
}

export function serviceStateText(value: string) {
  if (value === "active") return "运行正常";
  if (value === "activating") return "启动中";
  if (value === "deactivating") return "停止中";
  if (value === "inactive") return "未运行";
  if (value === "failed") return "运行故障";
  return "状态未知";
}

export function serviceDisplayLabel(entry: ServiceStatus) {
  return (
    String(entry?.label || entry?.name || "服务")
      .replace(/\s*状态\s*$/u, "")
      .trim() || "服务"
  );
}

export function serviceSummary(node: NodeSnapshot | null | undefined): {
  label: string;
  text: string;
  severity: Severity | "neutral";
} {
  const services = Array.isArray(node?.services) ? node.services : [];
  if (!services.length) return { label: "服务监测", text: "暂无上报", severity: "neutral" };
  const unhealthy = services.find((service) => service.state !== "active");
  if (services.length === 1) {
    return {
      label: services[0].label || services[0].name || "服务",
      text: serviceStateText(services[0].state),
      severity:
        services[0].state === "active"
          ? "healthy"
          : services[0].state === "failed"
            ? "critical"
            : "warning",
    };
  }
  return {
    label: "服务状态",
    text: unhealthy
      ? `${unhealthy.label || unhealthy.name} · ${serviceStateText(unhealthy.state)}`
      : `${services.length} 项均正常`,
    severity: unhealthy ? (unhealthy.state === "failed" ? "critical" : "warning") : "healthy",
  };
}

export function median(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function historicalRows(nodeId: string, probeName: string, history: HistorySnapshot | null) {
  return (history?.probes || [])
    .filter((row) => row.node_id === nodeId && row.probe_name === probeName)
    .sort((left, right) => Number(left.timestamp) - Number(right.timestamp));
}

export function probeThresholds(probe: Probe, rows: ProbeHistoryRow[] = []) {
  const baseline = median(
    rows
      .filter((row) => row.latency_ms != null)
      .map((row) => Number(row.latency_ms))
      .filter(Number.isFinite),
  );
  const warningMs =
    Number(probe?.warning_ms) > 0
      ? Number(probe.warning_ms)
      : baseline
        ? baseline * 1.35
        : Number.POSITIVE_INFINITY;
  const criticalMs =
    Number(probe?.critical_ms) > 0
      ? Number(probe.critical_ms)
      : baseline
        ? baseline * 1.7
        : Number.POSITIVE_INFINITY;
  const warningLoss =
    Number(probe?.warning_failure_percent) > 0 ? Number(probe.warning_failure_percent) : 1;
  const criticalLoss =
    Number(probe?.critical_failure_percent) > 0 ? Number(probe.critical_failure_percent) : 5;
  return { warningMs, criticalMs, warningLoss, criticalLoss };
}

export function probeMetricSeverity(
  metric: MetricKind,
  value: unknown,
  probe: Probe,
  rows: ProbeHistoryRow[] = [],
  success = true,
  complete = true,
): Severity {
  if (!success || complete === false) return "critical";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "healthy";
  const thresholds = probeThresholds(probe, rows);
  const warning = metric === "latency" ? thresholds.warningMs : thresholds.warningLoss;
  const critical = metric === "latency" ? thresholds.criticalMs : thresholds.criticalLoss;
  if (numeric >= critical) return "critical";
  if (numeric >= warning) return "warning";
  return "healthy";
}

export function energyLossSeverity(lossPercent: unknown, worstFiveMinuteLossPercent = 0): Severity {
  const loss = Number(lossPercent);
  const worstFiveMinuteLoss = Number(worstFiveMinuteLossPercent);
  if (!Number.isFinite(loss)) return "healthy";
  if (
    (Number.isFinite(worstFiveMinuteLoss) && worstFiveMinuteLoss >= ENERGY_LOSS_BURST_PERCENT) ||
    loss > ENERGY_LOSS_CRITICAL_PERCENT
  )
    return "critical";
  if (loss > ENERGY_LOSS_WARNING_PERCENT) return "warning";
  return "healthy";
}

export function measurementSeverity(
  {
    latency,
    loss,
    success = true,
    complete = true,
  }: { latency: unknown; loss: unknown; success?: boolean; complete?: boolean },
  probe: Probe,
  rows: ProbeHistoryRow[] = [],
): Severity {
  if (!success || complete === false) return "critical";
  return [
    probeMetricSeverity("latency", latency, probe, rows),
    probeMetricSeverity("loss", loss, probe, rows),
  ].reduce<Severity>(
    (worst, current) => (severityRank[current] > severityRank[worst] ? current : worst),
    "healthy",
  );
}

export function currentProbeSeverity(
  probe: Probe,
  nodeId: string,
  history: HistorySnapshot | null,
): Severity {
  const rows = historicalRows(nodeId, probe.name, history);
  return measurementSeverity(
    {
      latency: probe.duration_ms,
      loss: probe.packet_loss_percent ?? probe.sample_failure_percent,
      success: probe.success,
      complete: probe.complete,
    },
    probe,
    rows,
  );
}

export function nodeSeverity(node: NodeSnapshot, history: HistorySnapshot | null): Severity {
  if (!node?.online || node.data_error) return "offline";
  const serviceState = serviceSummary(node).severity;
  const service: Severity = serviceState === "neutral" ? "healthy" : serviceState;
  const probeSeverities = allProbes(node).map((probe) =>
    currentProbeSeverity(probe, node.id, history),
  );
  return [service, ...probeSeverities].reduce<Severity>(
    (worst, current) =>
      (severityRank[current] || 0) > (severityRank[worst] || 0) ? current : worst,
    "healthy",
  );
}

export function severityLabel(severity: string) {
  if (severity === "offline") return "上报中断";
  if (severity === "critical") return "异常";
  if (severity === "warning") return "需关注";
  return "正常";
}

// Historical cells weight actual attempts; their thresholds are independent of live probe status.
export function aggregateMetricEnergy(
  nodeId: string,
  probe: Probe,
  metric: MetricKind,
  history: HistorySnapshot | null,
  now: number,
) {
  const rows = historicalRows(nodeId, probe.name, history);
  const end = Number(history?.server_time || now);
  const start = end - ENERGY_WINDOW_HOURS * 3600;
  const slotSeconds = (end - start) / ENERGY_SLOTS;
  const thresholdsRows = rows.filter((row) => Number(row.timestamp) >= start);
  const buckets: EnergyBucket[] = [];
  for (let index = 0; index < ENERGY_SLOTS; index += 1) {
    const slotStart = start + index * slotSeconds;
    const slotEnd = slotStart + slotSeconds;
    const members = thresholdsRows.filter(
      (row) => Number(row.timestamp) >= slotStart && Number(row.timestamp) < slotEnd,
    );
    if (!members.length) {
      buckets.push({ empty: true, start: slotStart, end: slotEnd, severity: "empty" });
      continue;
    }
    if (metric === "loss") {
      const configuredSamples = Math.max(1, Number(probe?.samples) || 1);
      const totals = members.reduce(
        (total, row) => {
          const attempted = Number(row.attempted_samples);
          const successful = Number(row.successful_samples);
          const measurement = row.packet_loss_percent ?? row.sample_failure_percent;
          const rawLoss = measurement == null ? NaN : Number(measurement);
          if (Number.isFinite(attempted) && attempted > 0 && Number.isFinite(successful)) {
            total.attempted += attempted;
            total.successful += clamp(successful, 0, attempted);
          } else if (Number.isFinite(rawLoss)) {
            const estimatedAttempts = Math.max(1, Number(row.rounds) || 1) * configuredSamples;
            total.attempted += estimatedAttempts;
            total.successful += estimatedAttempts * (1 - clamp(rawLoss, 0, 100) / 100);
          }
          if (Number.isFinite(rawLoss))
            total.worstFiveMinuteLoss = Math.max(total.worstFiveMinuteLoss, rawLoss);
          return total;
        },
        { attempted: 0, successful: 0, worstFiveMinuteLoss: 0 },
      );
      const loss = totals.attempted
        ? (100 * (totals.attempted - totals.successful)) / totals.attempted
        : null;
      buckets.push({
        empty: loss === null,
        start: slotStart,
        end: slotEnd,
        value: loss,
        attempted: totals.attempted,
        successful: totals.successful,
        severeFiveMinuteLoss: totals.worstFiveMinuteLoss >= ENERGY_LOSS_BURST_PERCENT,
        severity: energyLossSeverity(loss, totals.worstFiveMinuteLoss),
      });
      continue;
    }
    const latencyValues = members
      .filter((row) => row.latency_ms != null)
      .map((row) => Number(row.latency_ms))
      .filter(Number.isFinite);
    const latency = latencyValues.length
      ? latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length
      : null;
    const value = latency;
    let severity = probeMetricSeverity("latency", value, probe, thresholdsRows, value !== null);
    let criticalSamples = 0;
    let warningSamples = 0;
    for (const row of members) {
      const sample = row.latency_ms;
      const rowSeverity = probeMetricSeverity(
        "latency",
        sample,
        probe,
        thresholdsRows,
        sample !== null &&
          Number.isFinite(Number(sample)) &&
          Number(row.success_percent ?? 100) > 0,
      );
      if (rowSeverity === "critical") criticalSamples += 1;
      else if (rowSeverity === "warning") warningSamples += 1;
    }
    const criticalRatio = criticalSamples / members.length;
    const warningRatio = warningSamples / members.length;
    if (severity !== "critical" && criticalRatio >= 0.25) severity = "critical";
    else if (severity === "healthy" && (criticalSamples > 0 || warningRatio >= 0.25))
      severity = "warning";
    buckets.push({ empty: false, start: slotStart, end: slotEnd, value, severity });
  }
  return buckets;
}

export function probeColorTone(probe: Probe) {
  const label = displayProbeLabel(probe);
  if (label.includes("电信")) return "telecom";
  if (label.includes("联通")) return "unicom";
  if (label.includes("移动")) return "mobile";
  if (probe.category === "node-link" || label.includes("→") || label.includes("->")) return "link";
  const key = String(probe?.name || label);
  const hash = [...key].reduce(
    (total, character) => (total * 31 + (character.codePointAt(0) ?? 0)) >>> 0,
    0,
  );
  return PROBE_COLOR_TONES[hash % PROBE_COLOR_TONES.length];
}
