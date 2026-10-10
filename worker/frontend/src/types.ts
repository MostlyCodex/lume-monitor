/** Public dashboard contracts. Credentials and Agent configuration never enter this model. */
export type Severity = "healthy" | "warning" | "critical" | "offline";
export type HistoryHours = 6 | 24 | 168 | 720 | 2160;
export type MetricKind = "latency" | "loss";
export type View = "loading" | "auth" | "dashboard";
export type Theme = "dark" | "light";
export interface CatalogNode {
  id: string;
  label: string;
  role?: string;
  region?: string;
  order?: number;
}
export interface TrafficCycle {
  rx_bytes: number;
  tx_bytes: number;
}
export interface NodeMetrics {
  cpu_count?: number | null;
  cpu_percent?: number | null;
  memory_used_percent?: number | null;
  memory_total_bytes?: number | null;
  disk_used_percent?: number | null;
  disk_total_bytes?: number | null;
  uptime_seconds?: number | null;
  network_rx_rate_bps?: number | null;
  network_tx_rate_bps?: number | null;
  network_valid?: boolean | null;
  network_interfaces?: string[] | null;
  traffic_cycle?: TrafficCycle | null;
}
export interface ServiceStatus {
  name: string;
  label?: string;
  state: string;
}
/** ICMP probes report packet loss; TCP probes only latency and whether the round succeeded. */
export interface Probe {
  name: string;
  label?: string;
  kind: "icmp" | "tcp";
  category?: string;
  order?: number;
  warning_ms?: number | null;
  critical_ms?: number | null;
  warning_failure_percent?: number | null;
  critical_failure_percent?: number | null;
  success?: boolean;
  complete?: boolean;
  duration_ms?: number | null;
  packet_loss_percent?: number | null;
  samples?: number;
}
export interface NodeSnapshot extends CatalogNode {
  online: boolean;
  data_error?: boolean;
  received_at?: number;
  country?: string | null;
  metrics: NodeMetrics;
  system?: { hostname?: string; os?: string; kernel?: string };
  services?: ServiceStatus[];
  probes?: Probe[];
}
export interface LatestSnapshot {
  schema_version: number;
  server_time: number;
  nodes: NodeSnapshot[];
  catalog: { nodes: CatalogNode[]; known_node_ids?: string[] };
}
export interface ProbeHistoryRow {
  node_id: string;
  probe_name: string;
  timestamp: number;
  latency_ms: number | null;
  packet_loss_percent?: number | null;
  success_percent?: number | null;
  attempted_samples?: number | null;
  successful_samples?: number | null;
  rounds?: number;
}
export interface MetricHistoryRow {
  node_id: string;
  timestamp: number;
  network_rx_rate_bps: number | null;
  network_tx_rate_bps: number | null;
}
export interface HistoryEvent {
  node_id: string;
  timestamp: number;
  severity: string;
  title: string;
  detail?: string;
}
export interface HistorySnapshot {
  schema_version: number;
  server_time: number;
  hours: number;
  selected_node: string | null;
  metrics: MetricHistoryRow[];
  probes: ProbeHistoryRow[];
  annotations: HistoryEvent[];
}
export interface DashboardLayout {
  order: string[];
}
export interface EnergyBucket {
  empty: boolean;
  start: number;
  end: number;
  severity: Severity | "empty";
  value?: number | null;
  attempted?: number;
  successful?: number;
  severeFiveMinuteLoss?: boolean;
}
export interface ChartPoint {
  x: number;
  y: number | null;
}
export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  points: ChartPoint[];
}
