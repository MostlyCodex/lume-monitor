export type NodeId = string;
export type Severity = "P1" | "P2" | "INFO";

export interface NodeMetadata {
  id: NodeId;
  display_name: string;
  role: string;
  region: string;
  stale_seconds: number;
  display_order: number;
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
  warning_ms: number;
  critical_ms: number;
  /** Packet-loss thresholds; always 0 for TCP probes. */
  warning_failure_percent: number;
  critical_failure_percent: number;
  severity: Severity;
  display_order: number;
  success: boolean;
  complete: boolean;
  duration_ms: number;
  samples: number;
  attempted_samples: number;
  successful_samples: number;
  checked_at: number;
}

export interface TrafficCycle {
  rx_bytes: number;
  tx_bytes: number;
}

export interface SystemMetrics {
  network_interfaces?: string[];
  network_valid?: boolean;
  network_scope?: string;
  traffic_cycle?: TrafficCycle;
  hostname: string;
  os: string;
  kernel: string;
  boot_id: string;
  uptime_seconds: number;
  cpu_percent: number;
  cpu_count?: number;
  memory_total_bytes: number;
  memory_available_bytes: number;
  root_total_bytes: number;
  root_used_percent: number;
  network_rx_bytes: number;
  network_tx_bytes: number;
}

export interface AgentHealth {
  config_fingerprint?: string;
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
  REVOKED_NODE_IDS?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_BIND_CODE_HASH?: string;
  ADMIN_TOKEN?: string;
}

export interface SourceIdentity {
  ip: string | null;
  country: string | null;
}
