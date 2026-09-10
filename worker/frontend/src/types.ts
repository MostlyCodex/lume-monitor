/** Public dashboard contracts. Credentials and Agent configuration never enter this model. */
export type Severity = "healthy" | "warning" | "critical" | "offline";
export type HistoryHours = 6 | 24 | 168 | 720 | 2160;
export type MetricKind = "latency" | "loss";
export type NetworkLayer = MetricKind;
export type View = "loading" | "auth" | "dashboard";
export type Theme = "dark" | "light";
export interface NodeDisplay {
  label: string;
  role?: string;
  country?: string;
  region?: string;
}
export interface CatalogNode extends NodeDisplay {
  id: string;
  order?: number;
}
export interface TrafficCycle {
  reset_day: number;
  time_zone: "UTC" | "Asia/Shanghai";
  period_start: number;
  period_end: number;
  observed_since: number;
  rx_bytes: number;
  tx_bytes: number;
  partial: boolean;
}
export interface NodeMetrics {
  cpu_count?: number | null;
  cpu_percent?: number | null;
  memory_used_percent?: number | null;
  memory_total_bytes?: number | null;
  memory_available_bytes?: number | null;
  disk_used_percent?: number | null;
  disk_total_bytes?: number | null;
  disk_free_bytes?: number | null;
  uptime_seconds?: number | null;
  network_rx_rate_bps?: number | null;
  network_tx_rate_bps?: number | null;
  network_rx_bytes?: number | null;
  network_tx_bytes?: number | null;
  network_valid?: boolean | null;
  network_interfaces?: string[] | null;
  traffic_cycle_enabled?: boolean;
  traffic_cycle?: TrafficCycle | null;
}
export interface ServiceStatus {
  name: string;
  label?: string;
  state: string;
}
export interface ProbeThresholds {
  warning_ms?: number | null;
  critical_ms?: number | null;
  warning_failure_percent?: number | null;
  critical_failure_percent?: number | null;
}
export interface Probe extends ProbeThresholds {
  name: string;
  label?: string;
  kind: "icmp" | "tcp";
  category?: string;
  order?: number;
  success?: boolean;
  complete?: boolean;
  duration_ms?: number | null;
  packet_loss_percent?: number | null;
  sample_failure_percent?: number | null;
  samples?: number;
}
export interface NodeSnapshot extends CatalogNode {
  online: boolean;
  data_error?: boolean;
  age_seconds?: number;
  received_at?: number;
  reported_at?: number;
  metrics: NodeMetrics;
  system?: { hostname?: string; os?: string; kernel?: string };
  agent?: { version?: string; queue_depth?: number; collect_errors?: number; send_errors?: number };
  services?: ServiceStatus[];
  probes?: Probe[];
}
export interface LatestSnapshot {
  schema_version: number;
  server_time: number;
  nodes: NodeSnapshot[];
  catalog: { nodes: CatalogNode[]; known_node_ids?: string[] };
  cadence?: { resources_seconds: number; probes_seconds: number };
}
export interface ProbeHistoryRow extends ProbeThresholds {
  node_id: string;
  probe_name: string;
  timestamp: number;
  latency_ms: number | null;
  packet_loss_percent?: number | null;
  sample_failure_percent?: number | null;
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
export interface ProbeSummary {
  probe_name: string;
  latency_average_ms: number | null;
  sample_failure_percent: number | null;
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
  bucket_seconds: number;
  selected_node: string | null;
  metrics: MetricHistoryRow[];
  probes: ProbeHistoryRow[];
  probe_summaries?: ProbeSummary[];
  annotations: HistoryEvent[];
}
export interface DashboardLayout {
  brand: string;
  order: string[];
  nodes: Record<string, NodeDisplay>;
  background: string;
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
  label: string;
  color: string;
  points: ChartPoint[];
  lossPoints?: ChartPoint[];
  failureLabel?: string;
}
