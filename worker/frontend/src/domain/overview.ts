import type { HistorySnapshot, LatestSnapshot, NodeSnapshot } from "../types";
import { allProbes, currentProbeSeverity, nodeSeverity } from "./probes";
import { formatInterval } from "./format";
export function overview(
  nodes: NodeSnapshot[],
  history: HistorySnapshot | null,
  latest: LatestSnapshot | null,
) {
  const online = nodes.filter((node) => node.online && !node.data_error).length;
  const checks = nodes.flatMap((node) => allProbes(node).map((probe) => ({ node, probe })));
  const healthy = checks.filter(
    ({ node, probe }) => currentProbeSeverity(probe, node.id, history) === "healthy",
  ).length;
  const severities = nodes.map((node) => nodeSeverity(node, history));
  const attention = severities.filter((value) => value !== "healthy").length;
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
    summary: [
      {
        label: "在线节点",
        value: `${online}/${nodes.length}`,
        tone: online < nodes.length ? "critical" : "",
      },
      {
        label: "探测正常",
        value: `${healthy}/${checks.length}`,
        tone: healthy < checks.length ? "warning" : "",
      },
      { label: "需关注", value: String(attention), tone: attention ? "warning" : "" },
      { label: "探针周期", value: formatInterval(latest?.cadence?.probes_seconds ?? 60), tone: "" },
    ],
  };
}
export type Overview = ReturnType<typeof overview>;
