import type { DashboardLayout, LatestSnapshot, NodeSnapshot } from "../types";

/** Overlay browser-only labels without mutating the API snapshot. */
export function displayNodes(
  latest: LatestSnapshot | null,
  layout: DashboardLayout,
): NodeSnapshot[] {
  const preferred = new Map(layout.order.map((id, index) => [id, index]));
  const snapshots = new Map(latest?.nodes.map((node) => [node.id, node]));
  return [...(latest?.catalog.nodes ?? [])]
    .sort((a, b) => {
      const rank =
        (preferred.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (preferred.get(b.id) ?? Number.MAX_SAFE_INTEGER);
      return (
        rank ||
        Number(a.order ?? 0) - Number(b.order ?? 0) ||
        a.label.localeCompare(b.label, "zh-CN")
      );
    })
    .map((meta) => {
      const node: NodeSnapshot = snapshots.get(meta.id) ?? {
        ...meta,
        online: false,
        data_error: true,
        metrics: {},
        probes: [],
        services: [],
      };
      const override = layout.nodes[node.id];
      return {
        ...node,
        label: override?.label || node.label,
        role: override?.role || node.role,
        region: override?.region || node.region,
        country: override?.country || node.country,
      };
    });
}
