import type { NodeMetrics } from "../types";
import { formatBytes } from "./format";

// 流量按周期统计（每月重置日清零，从 Agent 开始统计时起算）
export function trafficSummary(metrics: NodeMetrics) {
  const cycle = metrics.traffic_cycle;
  const valid = metrics.network_valid !== false;
  const format = (value: number | null | undefined) =>
    valid && Number.isFinite(value) ? formatBytes(value) : "—";
  // 总量 = 上传 + 下载；任一方向还没上报时总量也未知
  const total =
    Number.isFinite(cycle?.rx_bytes) && Number.isFinite(cycle?.tx_bytes)
      ? Number(cycle?.rx_bytes) + Number(cycle?.tx_bytes)
      : null;
  return {
    label: "周期流量",
    rx: format(cycle?.rx_bytes),
    tx: format(cycle?.tx_bytes),
    total: format(total),
  };
}
