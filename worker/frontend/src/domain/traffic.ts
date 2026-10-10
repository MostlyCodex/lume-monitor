import type { NodeMetrics } from "../types";
import { formatBytes } from "./format";

// 流量按周期统计（每月重置日清零，从 Agent 开始统计时起算）
export function trafficSummary(metrics: NodeMetrics) {
  const cycle = metrics.traffic_cycle;
  const valid = metrics.network_valid !== false;
  const format = (value: number | null | undefined) =>
    valid && Number.isFinite(value) ? formatBytes(value) : "—";
  return { label: "周期流量", rx: format(cycle?.rx_bytes), tx: format(cycle?.tx_bytes) };
}
