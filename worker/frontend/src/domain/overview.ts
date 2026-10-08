import type { HistorySnapshot, NodeSnapshot } from "../types";
import { nodeSeverity } from "./probes";
export function overview(nodes: NodeSnapshot[], history: HistorySnapshot | null) {
  const severities = nodes.map((node) => nodeSeverity(node, history));
  const critical = severities.some((value) => value === "critical" || value === "offline");
  const warning = !critical && severities.includes("warning");
  return {
    tone: critical ? "critical" : warning ? "warning" : "healthy",
    title: critical ? "存在关键异常" : warning ? "部分线路需关注" : "所有节点运行正常",
    detail: critical
      ? "请进入异常节点查看"
      : warning
        ? "业务仍在运行"
        : `${nodes.length} 个节点持续上报`,
  };
}
export type Overview = ReturnType<typeof overview>;
