export type NodeId = string;
export type Severity = "P1" | "P2" | "INFO";

export interface NodeMetadata {
  id: NodeId;
  display_name: string;
  short_mark: string;
  role: string;
  group: string;
  region: string;
  stale_seconds: number;
  display_order: number;
  color: string;
  offline_severity: Severity;
  ip_change_severity: Severity;
}

export interface ServiceStatus {
  name: string;
  label: string;
  severity: Severity;
  state: string;
}

export interface ProbeResult {
  name: string;
  label: string;
  category: string;
  target_node_id?: NodeId;
  kind: "icmp" | "tcp";
  target: string;
  port?: number;
  warning_ms: number;
  critical_ms: number;
  warning_failure_percent: number;
  critical_failure_percent: number;
  severity: Severity;
  display_order: number;
  primary?: boolean;
  success: boolean;
  complete: boolean;
  duration_ms: number;
  average_duration_ms?: number;
  p95_duration_ms?: number;
  min_duration_ms?: number;
  max_duration_ms?: number;
  range_ms?: number;
  jitter_ms?: number;
  samples: number;
  attempted_samples: number;
  successful_samples: number;
  sample_failure_percent: number;
  packet_loss_percent?: number;
  remote_ip?: string;
  error?: string;
  checked_at: number;
}

export interface CounterResult {
  name: string;
  label: string;
  kind: "nftables-rule";
  unit: "matches";
  display_order: number;
  complete: boolean;
  baseline?: boolean;
  reset?: boolean;
  delta?: number;
  interval_seconds?: number;
  rate_per_minute?: number;
  observed_at: number;
  error?: string;
}

export interface SystemMetrics {
  hostname: string;
  os: string;
  kernel: string;
  arch: string;
  boot_id: string;
  uptime_seconds: number;
  cpu_percent: number;
  load1: number;
  load5: number;
  load15: number;
  memory_total_bytes: number;
  memory_available_bytes: number;
  swap_total_bytes: number;
  swap_used_bytes: number;
  root_total_bytes: number;
  root_free_bytes: number;
  root_used_percent: number;
  root_inode_used_percent: number;
  network_rx_bytes: number;
  network_tx_bytes: number;
  network_rx_errors: number;
  network_tx_errors: number;
  network_rx_drops: number;
  network_tx_drops: number;
}

export interface AgentHealth {
  queue_depth: number;
  collect_errors: number;
  send_errors: number;
  started_at: number;
}

export interface AgentReport {
  schema_version: 2;
  agent_version: string;
  node_id: NodeId;
  node: NodeMetadata;
  generated_at: number;
  system: SystemMetrics;
  services: ServiceStatus[];
  probes: ProbeResult[];
  counters: CounterResult[];
  agent: AgentHealth;
}

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_VERSION: string;
  REPORT_MAX_AGE_SECONDS: string;
  TELEGRAM_BOT_USERNAME: string;
  DASHBOARD_BASE_URL: string;
  NODE_KEYS?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_BIND_CODE_HASH?: string;
  ADMIN_TOKEN?: string;
}

export interface SourceIdentity {
  ip: string | null;
  asn: number | null;
  org: string | null;
  country: string | null;
  colo: string | null;
}
