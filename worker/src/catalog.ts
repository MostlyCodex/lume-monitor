import type { Env, NodeId, Severity } from "./types";

export interface NodeCatalogRow {
  node_id: NodeId;
  public_id: string;
  display_name: string;
  short_mark: string;
  role_label: string;
  group_name: string;
  region_label: string;
  stale_seconds: number;
  display_order: number;
  color_key: string;
  offline_severity: Severity;
  ip_change_severity: Severity;
  enabled: number;
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

export interface CounterCatalogRow {
  node_id: NodeId;
  counter_name: string;
  public_id: string;
  display_name: string;
  kind: "nftables-rule";
  unit: "matches";
  display_order: number;
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
  nodes: NodeCatalogRow[];
  services: ServiceCatalogRow[];
  probes: ProbeCatalogRow[];
  counters: CounterCatalogRow[];
  metrics: MetricCatalogRow[];
  routes: BusinessRouteRow[];
}

export async function loadDashboardCatalog(env: Env): Promise<DashboardCatalog> {
  const [nodes, services, probes, counters, metrics, routes] = await Promise.all([
    env.DB.prepare(
      "SELECT node_id, public_id, display_name, short_mark, role_label, group_name, region_label, " +
        "stale_seconds, display_order, color_key, offline_severity, ip_change_severity, enabled " +
        "FROM node_catalog WHERE enabled = 1 ORDER BY display_order, display_name",
    ).all<NodeCatalogRow>(),
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
      "SELECT node_id, counter_name, public_id, display_name, kind, unit, display_order, enabled " +
        "FROM counter_catalog WHERE enabled = 1 ORDER BY node_id, display_order, display_name",
    ).all<CounterCatalogRow>(),
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
  return {
    nodes: nodes.results,
    services: services.results,
    probes: probes.results,
    counters: counters.results,
    metrics: metrics.results,
    routes: routes.results,
  };
}

export function publicCounterCatalogEntry(
  counter: CounterCatalogRow,
  nodePublicId: string,
): Record<string, unknown> {
  return {
    node_id: nodePublicId,
    name: counter.public_id,
    label: counter.display_name,
    kind: counter.kind,
    unit: counter.unit,
    order: counter.display_order,
  };
}

export function publicNodeCatalogEntry(node: NodeCatalogRow): Record<string, unknown> {
  return {
    id: node.public_id,
    label: node.display_name,
    mark: node.short_mark,
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
