import type { NodeMetrics, TrafficCycle } from "../types";
import { formatBytes } from "./format";

export function trafficSummary(metrics: NodeMetrics) {
  const cycle = metrics.traffic_cycle;
  const enabled = metrics.traffic_cycle_enabled ?? Boolean(cycle);
  const valid = metrics.network_valid !== false;
  const format = (value: number | null | undefined) =>
    valid && Number.isFinite(value) ? formatBytes(value) : "—";
  return {
    label: enabled ? "本周期流量" : "累计流量",
    rx: format(enabled ? cycle?.rx_bytes : metrics.network_rx_bytes),
    tx: format(enabled ? cycle?.tx_bytes : metrics.network_tx_bytes),
    description:
      enabled && !cycle
        ? "周期流量暂不可用，请查看 Agent 采集错误与日志"
        : cycle
          ? `所选网卡的已观测流量 · ${cycle.time_zone}${cycle.partial ? " · 非完整周期" : ""}`
          : "所选网卡的系统累计计数，系统或网卡重置后重新起算",
  };
}

export function cycleDescription(cycle: TrafficCycle | null | undefined) {
  if (!cycle) return "统计暂不可用，请查看 Agent 日志";
  const format = (seconds: number) =>
    new Intl.DateTimeFormat("zh-CN", {
      timeZone: cycle.time_zone,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(seconds * 1000));
  return `${format(cycle.period_start)} 至 ${format(cycle.period_end)} · ${cycle.time_zone === "Asia/Shanghai" ? "UTC+8" : "UTC"}${cycle.partial ? ` · 已观测部分，自 ${format(cycle.observed_since)}` : ""}`;
}
