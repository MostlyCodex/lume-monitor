import type {
  EnergyBucket,
  HistorySnapshot,
  MetricKind,
  NodeSnapshot,
  Probe,
  ServiceStatus,
  Tone,
} from "../types";
import { clamp } from "./format";

// 24 cells of one hour each over the last 24 hours.
const ENERGY_SLOTS = 24;
const ENERGY_WINDOW_HOURS = 24;
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
    .replace(/\s*·\s*TCP(?:\s*\d+)?\s*$/i, "")
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

export function historicalRows(nodeId: string, probeName: string, history: HistorySnapshot | null) {
  return (history?.probes || [])
    .filter((row) => row.node_id === nodeId && row.probe_name === probeName)
    .sort((left, right) => Number(left.timestamp) - Number(right.timestamp));
}

// One fixed scale per metric, shared by the cells and the values above them.
export function latencyTone(ms: number | null | undefined): Tone {
  const value = Number(ms);
  if (ms == null || !Number.isFinite(value)) return "red";
  if (value < 80) return "green";
  if (value < 160) return "blue";
  if (value < 240) return "yellow";
  return "red";
}

export function lossTone(percent: number | null | undefined): Tone {
  const value = Number(percent);
  if (percent == null || !Number.isFinite(value)) return "red";
  // Under 1% stays green: one lost sample in a cell of 240-400 reads 0.25-0.42%.
  if (value < 1) return "green";
  if (value < 5) return "blue";
  if (value < 20) return "yellow";
  return "red";
}

// Each cell covers one hour of the last 24. Latency is the mean of the cell's
// successful samples, and a cell where nothing answered is red; loss weights
// every attempted sample in the cell.
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
  const windowRows = rows.filter((row) => Number(row.timestamp) >= start);
  const buckets: EnergyBucket[] = [];
  for (let index = 0; index < ENERGY_SLOTS; index += 1) {
    const slotStart = start + index * slotSeconds;
    const slotEnd = slotStart + slotSeconds;
    const members = windowRows.filter(
      (row) => Number(row.timestamp) >= slotStart && Number(row.timestamp) < slotEnd,
    );
    if (!members.length) {
      buckets.push({ empty: true, start: slotStart, end: slotEnd, tone: "empty" });
      continue;
    }
    if (metric === "loss") {
      const configuredSamples = Math.max(1, Number(probe?.samples) || 1);
      const totals = members.reduce(
        (total, row) => {
          const attempted = Number(row.attempted_samples);
          const successful = Number(row.successful_samples);
          const rawLoss = row.packet_loss_percent == null ? NaN : Number(row.packet_loss_percent);
          if (Number.isFinite(attempted) && attempted > 0 && Number.isFinite(successful)) {
            total.attempted += attempted;
            total.successful += clamp(successful, 0, attempted);
          } else if (Number.isFinite(rawLoss)) {
            // Rolled-up rows carry a percentage instead of sample counts.
            const estimatedAttempts = Math.max(1, Number(row.rounds) || 1) * configuredSamples;
            total.attempted += estimatedAttempts;
            total.successful += estimatedAttempts * (1 - clamp(rawLoss, 0, 100) / 100);
          }
          return total;
        },
        { attempted: 0, successful: 0 },
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
        tone: loss === null ? "empty" : lossTone(loss),
      });
      continue;
    }
    const latencyValues = members
      .filter((row) => row.latency_ms != null)
      .map((row) => Number(row.latency_ms))
      .filter(Number.isFinite);
    const value = latencyValues.length
      ? latencyValues.reduce((sum, sample) => sum + sample, 0) / latencyValues.length
      : null;
    buckets.push({ empty: false, start: slotStart, end: slotEnd, value, tone: latencyTone(value) });
  }
  return buckets;
}

/** Loss over every attempted sample in the cells, the same weighting each cell uses. */
export function windowLoss(buckets: EnergyBucket[]): number | null {
  const attempted = buckets.reduce((sum, bucket) => sum + (bucket.attempted ?? 0), 0);
  const successful = buckets.reduce((sum, bucket) => sum + (bucket.successful ?? 0), 0);
  return attempted > 0 ? (100 * (attempted - successful)) / attempted : null;
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
