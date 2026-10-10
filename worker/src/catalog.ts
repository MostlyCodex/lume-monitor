import type { Env, NodeId, Severity } from "./types";

export interface NodeCatalogRow {
  node_id: NodeId;
  public_id: string;
  display_name: string;
  role_label: string;
  region_label: string;
  stale_seconds: number;
  display_order: number;
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
  enabled: number;
}

export interface DashboardCatalog {
  knownNodeIds?: string[];
  nodes: NodeCatalogRow[];
  services: ServiceCatalogRow[];
  probes: ProbeCatalogRow[];
}

export async function loadDashboardCatalog(env: Env): Promise<DashboardCatalog> {
  const [nodes, known, services, probes] = await Promise.all([
    env.DB.prepare(
      "SELECT node_id, public_id, display_name, role_label, region_label, stale_seconds, display_order, enabled, retired_at " +
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
        "warning_failure_percent, critical_failure_percent, severity, display_order, enabled " +
        "FROM probe_catalog WHERE enabled = 1 ORDER BY node_id, display_order, display_name",
    ).all<ProbeCatalogRow>(),
  ]);
  // A node pending deletion keeps its own catalog rows disabled, but a peer that still
  // reports a node-link probe toward it would re-enable that probe on every
  // report. Filtering on read keeps deletion independent of whether every peer
  // configuration has been updated yet.
  const deletingNodeIds = new Set(known.results.filter((row) => row.retired_at !== null).map((row) => row.node_id));
  const visibleNode = (nodeId: NodeId): boolean => !deletingNodeIds.has(nodeId);
  const visibleTarget = (targetNodeId: NodeId | null): boolean =>
    targetNodeId === null || !deletingNodeIds.has(targetNodeId);
  return {
    // Keep IDs until deletion finishes so failed cleanup does not prune preferences early.
    knownNodeIds: known.results.map((row) => row.public_id),
    nodes: nodes.results,
    services: services.results.filter((service) => visibleNode(service.node_id)),
    probes: probes.results.filter(
      (probe) => visibleNode(probe.node_id) && visibleTarget(probe.target_node_id),
    ),
  };
}

export function publicNodeCatalogEntry(node: NodeCatalogRow): Record<string, unknown> {
  return {
    id: node.public_id,
    label: node.display_name,
    role: node.role_label,
    region: node.region_label,
    order: node.display_order,
  };
}
