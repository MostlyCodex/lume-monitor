import type { Env, NodeId, Severity } from "./types";

export interface NodeCatalogRow {
  node_id: NodeId;
  public_id: string;
  display_name: string;
  role_label: string;
  group_name: string;
  region_label: string;
  stale_seconds: number;
  display_order: number;
  color_key: string;
  offline_severity: Severity;
  ip_change_severity: Severity;
  enabled: number;
  retired_at: number | null;
}

export interface ServiceCatalogRow {
  node_id: NodeId;
  service_name: string;
  display_name: string;
  severity: Severity;
  display_order: number;
  enabled: number;
}

export interface ProbeCatalogRow {
  node_id: NodeId;
  probe_name: string;
  public_id: string;
  display_name: string;
  category: string;
  kind: "icmp" | "tcp";
  target_node_id: NodeId | null;
  warning_ms: number | null;
  critical_ms: number | null;
  warning_failure_percent: number | null;
  critical_failure_percent: number | null;
  severity: Severity;
  display_order: number;
  is_primary: number;
  enabled: number;
}

export interface MetricCatalogRow {
  metric_key: string;
  display_name: string;
  unit: string;
  category: string;
  warning_value: number | null;
  critical_value: number | null;
  display_order: number;
  default_visible: number;
}

export interface BusinessRouteRow {
  route_key: string;
  display_name: string;
  source_node_id: NodeId;
  target_node_id: NodeId | null;
  probe_name: string;
  target_label: string;
  warning_ms: number;
  critical_ms: number;
  display_order: number;
  enabled: number;
}

export interface DashboardCatalog {
  knownNodeIds?: string[];
  nodes: NodeCatalogRow[];
  services: ServiceCatalogRow[];
  probes: ProbeCatalogRow[];
  metrics: MetricCatalogRow[];
  routes: BusinessRouteRow[];
}

export async function loadDashboardCatalog(env: Env): Promise<DashboardCatalog> {
  const [nodes, known, services, probes, metrics, routes] = await Promise.all([
    env.DB.prepare(
      "SELECT node_id, public_id, display_name, role_label, group_name, region_label, " +
        "stale_seconds, display_order, color_key, offline_severity, ip_change_severity, enabled, retired_at " +
        "FROM node_catalog WHERE enabled = 1 AND retired_at IS NULL ORDER BY display_order, display_name",
    ).all<NodeCatalogRow>(),
    env.DB.prepare(
      "SELECT node_id,public_id,retired_at FROM node_catalog",
    ).all<{ node_id: NodeId; public_id: string; retired_at: number | null }>(),
    env.DB.prepare(
      "SELECT node_id, service_name, display_name, severity, display_order, enabled " +
        "FROM service_catalog WHERE enabled = 1 ORDER BY node_id, display_order, display_name",
    ).all<ServiceCatalogRow>(),
    env.DB.prepare(
      "SELECT node_id, probe_name, public_id, display_name, category, kind, target_node_id, warning_ms, critical_ms, " +
        "warning_failure_percent, critical_failure_percent, " +
        "severity, display_order, is_primary, enabled FROM probe_catalog WHERE enabled = 1 " +
        "ORDER BY node_id, display_order, display_name",
    ).all<ProbeCatalogRow>(),
    env.DB.prepare(
      "SELECT metric_key, display_name, unit, category, warning_value, critical_value, " +
        "display_order, default_visible FROM metric_catalog ORDER BY display_order, display_name",
    ).all<MetricCatalogRow>(),
    env.DB.prepare(
      "SELECT route_key, display_name, source_node_id, target_node_id, probe_name, target_label, " +
        "warning_ms, critical_ms, display_order, enabled FROM business_routes WHERE enabled = 1 " +
        "ORDER BY display_order, display_name",
    ).all<BusinessRouteRow>(),
  ]);
  // A retired node keeps its own catalog rows disabled, but a peer that still
  // reports a node-link probe toward it would re-enable that probe and its
  // route on every report. Filtering on read makes retirement independent of
  // whether every peer configuration has been updated yet.
  const retiredNodeIds = new Set(known.results.filter((row) => row.retired_at !== null).map((row) => row.node_id));
  const visibleNode = (nodeId: NodeId): boolean => !retiredNodeIds.has(nodeId);
  const visibleTarget = (targetNodeId: NodeId | null): boolean =>
    targetNodeId === null || !retiredNodeIds.has(targetNodeId);
  return {
    // Include recoverable nodes so browsers only prune permanently deleted IDs.
    knownNodeIds: known.results.map((row) => row.public_id),
    nodes: nodes.results,
    services: services.results.filter((service) => visibleNode(service.node_id)),
    probes: probes.results.filter(
      (probe) => visibleNode(probe.node_id) && visibleTarget(probe.target_node_id),
    ),
    metrics: metrics.results,
    routes: routes.results.filter(
      (route) => visibleNode(route.source_node_id) && visibleTarget(route.target_node_id),
    ),
  };
}

export function publicNodeCatalogEntry(node: NodeCatalogRow): Record<string, unknown> {
  return {
    id: node.public_id,
    label: node.display_name,
    role: node.role_label,
    group: node.group_name,
    region: node.region_label,
    stale_seconds: node.stale_seconds,
    order: node.display_order,
    color: node.color_key,
  };
}

export function publicProbeCatalogEntry(
  probe: ProbeCatalogRow,
  nodePublicId: string,
): Record<string, unknown> {
  return {
    node_id: nodePublicId,
    name: probe.public_id,
    label: probe.display_name,
    category: probe.category,
    kind: probe.kind,
    target_node_id: probe.target_node_id,
    warning_ms: probe.warning_ms,
    critical_ms: probe.critical_ms,
    warning_failure_percent: probe.warning_failure_percent,
    critical_failure_percent: probe.critical_failure_percent,
    severity: probe.severity,
    order: probe.display_order,
    primary: probe.is_primary === 1,
  };
}
