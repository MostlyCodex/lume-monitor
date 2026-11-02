import type { DashboardLayout, LatestSnapshot, NodeSnapshot } from "../types";

/** Apply the browser-only node order without mutating the API snapshot. */
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
    .map(
      (meta): NodeSnapshot =>
        snapshots.get(meta.id) ?? {
          ...meta,
          online: false,
          data_error: true,
          metrics: {},
          probes: [],
          services: [],
        },
    );
}

/**
 * 节点地区只显示配置里填写的地区（lumectl 的“国家 / 城市”），没填就留空。
 * 不用 country：那是 Cloudflare 按上报来源 IP 推断的国家代码，经代理上报的节点会显示成代理所在地。
 */
export function nodeRegion(node: Pick<NodeSnapshot, "region">) {
  const region = String(node.region ?? "").trim();
  return region === "unspecified" ? "" : region;
}
