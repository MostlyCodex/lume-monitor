import type { NodeCatalogRow } from "./catalog";
import type { AgentReport, NodeId, ProbeResult } from "./types";

export interface TelegramStatusNodeRow {
  node_id: NodeId;
  received_at: number;
  report_json: string;
}

function compactAge(receivedAt: number, now: number): string {
  const seconds = Math.max(0, now - receivedAt);
  if (seconds < 60) return `${seconds}秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时${Math.floor((seconds % 3600) / 60)}分前`;
  return `${Math.floor(seconds / 86400)}天前`;
}

function serviceLine(report: AgentReport): string | null {
  if (report.services.length === 0) return null;
  return report.services
    .map((service) => service.state === "active" ? `${service.label} ✓` : `${service.label} ⚠ ${service.state}`)
    .join(" · ");
}

function nodeStatusIcon(
  node: TelegramStatusNodeRow,
  meta: NodeCatalogRow,
  report: AgentReport,
  now: number,
): string {
  if (now - node.received_at > meta.stale_seconds) return "🔴";
  const unhealthyServices = report.services.filter((service) => service.state !== "active");
  if (unhealthyServices.some((service) => service.severity === "P1")) return "🔴";
  if (unhealthyServices.length > 0) return "🟡";
  return "🟢";
}

function resourceLine(report: AgentReport): string {
  const memoryUsed = report.system.memory_total_bytes > 0
    ? 100 - (report.system.memory_available_bytes / report.system.memory_total_bytes) * 100
    : 0;
  return [
    `CPU ${Math.round(report.system.cpu_percent)}%`,
    `RAM ${Math.round(memoryUsed)}%`,
    `Disk ${Math.round(report.system.root_used_percent)}%`,
  ].join(" · ");
}

function probeLine(probe: ProbeResult): string {
  if (!probe.complete) return `${probe.label} ${probe.attempted_samples}/${probe.samples}`;
  const failurePercent = probe.kind === "icmp"
    ? probe.packet_loss_percent ?? probe.sample_failure_percent
    : probe.sample_failure_percent;
  if (!probe.success) return `${probe.label} 不可达/${Math.round(failurePercent)}%`;
  return `${probe.label} ${Math.round(probe.duration_ms)}ms/${Math.round(failurePercent)}%`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function updateTimestamp(now: number): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(now * 1000));
  const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("month")}-${value("day")} ${value("hour")}:${value("minute")} CST`;
}

export function formatTelegramStatusMessage(
  catalogNodes: NodeCatalogRow[],
  nodeRows: TelegramStatusNodeRow[],
  now: number,
): string {
  const rows = new Map(nodeRows.map((node) => [node.node_id, node]));
  const parsed = new Map<NodeId, AgentReport>();
  let onlineCount = 0;

  for (const meta of catalogNodes) {
    const node = rows.get(meta.node_id);
    if (!node) continue;
    try {
      parsed.set(meta.node_id, JSON.parse(node.report_json) as AgentReport);
      if (now - node.received_at <= meta.stale_seconds) onlineCount += 1;
    } catch {
      // Invalid reports are shown as unavailable below and are not counted online.
    }
  }

  const lines = [
    `🏔 远山Monitor · ${onlineCount}/${catalogNodes.length} 在线`,
    `更新 ${updateTimestamp(now)}`,
    "",
  ];

  if (catalogNodes.length === 0) lines.push("尚无已注册节点。", "");
  for (const meta of catalogNodes) {
    const node = rows.get(meta.node_id);
    const report = parsed.get(meta.node_id);
    if (!node) {
      lines.push(`🔴 ${meta.display_name} · 尚无数据`, "");
      continue;
    }
    if (!report) {
      lines.push(`🔴 ${meta.display_name} · 数据异常`, "");
      continue;
    }

    lines.push(`${nodeStatusIcon(node, meta, report, now)} ${meta.display_name} · ${compactAge(node.received_at, now)}`);
    lines.push(resourceLine(report));
    const services = serviceLine(report);
    if (services) lines.push(services);
    const probes = [...report.probes]
      .sort((left, right) => left.display_order - right.display_order)
      .slice(0, 4)
      .map(probeLine);
    for (const group of chunk(probes, 2)) lines.push(group.join(" · "));
    lines.push("");
  }

  lines.push("🔎 /panel 查看详细图表");
  return lines.join("\n");
}
