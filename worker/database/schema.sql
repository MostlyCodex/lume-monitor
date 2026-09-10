-- Current Lume database. Initialize an empty D1 database through the management tool.
-- Node catalogs are populated by authenticated reports; no node data is seeded.

CREATE TABLE node_catalog (
  node_id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role_label TEXT NOT NULL,
  group_name TEXT NOT NULL,
  region_label TEXT NOT NULL,
  stale_seconds INTEGER NOT NULL,
  display_order INTEGER NOT NULL,
  color_key TEXT NOT NULL,
  offline_severity TEXT NOT NULL CHECK (offline_severity IN ('P1', 'P2', 'INFO')),
  ip_change_severity TEXT NOT NULL CHECK (ip_change_severity IN ('P1', 'P2', 'INFO')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL,
  retired_at INTEGER
);

CREATE INDEX idx_node_catalog_order
  ON node_catalog(enabled, retired_at, display_order, display_name);

CREATE TABLE service_catalog (
  node_id TEXT NOT NULL,
  service_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('P1', 'P2', 'INFO')),
  display_order INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (node_id, service_name)
);

CREATE TABLE probe_catalog (
  node_id TEXT NOT NULL,
  probe_name TEXT NOT NULL,
  public_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'icmp' CHECK (kind IN ('icmp', 'tcp')),
  target_node_id TEXT,
  warning_ms REAL,
  critical_ms REAL,
  warning_failure_percent REAL NOT NULL DEFAULT 0
    CHECK (warning_failure_percent BETWEEN 0 AND 100),
  critical_failure_percent REAL NOT NULL DEFAULT 0
    CHECK (critical_failure_percent BETWEEN 0 AND 100),
  severity TEXT NOT NULL CHECK (severity IN ('P1', 'P2', 'INFO')),
  display_order INTEGER NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (node_id, probe_name)
);

CREATE INDEX idx_probe_catalog_order
  ON probe_catalog(node_id, enabled, display_order, display_name);

CREATE TABLE business_routes (
  route_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT,
  probe_name TEXT NOT NULL,
  target_label TEXT NOT NULL,
  warning_ms REAL NOT NULL,
  critical_ms REAL NOT NULL,
  display_order INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_business_routes_order ON business_routes(enabled, display_order, display_name);

CREATE TABLE metric_catalog (
  metric_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  category TEXT NOT NULL,
  warning_value REAL,
  critical_value REAL,
  display_order INTEGER NOT NULL,
  default_visible INTEGER NOT NULL DEFAULT 1 CHECK (default_visible IN (0, 1))
);

CREATE TABLE node_latest (
  node_id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL,
  reported_at INTEGER NOT NULL,
  source_ip TEXT,
  source_asn INTEGER,
  source_org TEXT,
  source_country TEXT,
  source_colo TEXT,
  approved_ip TEXT,
  last_boot_id TEXT,
  report_json TEXT NOT NULL,
  recent_nonces_json TEXT NOT NULL DEFAULT '[]',
  network_rx_rate_bps REAL,
  network_tx_rate_bps REAL
);

CREATE TABLE snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  reported_at INTEGER NOT NULL,
  source_ip TEXT,
  report_json TEXT NOT NULL
);

CREATE INDEX idx_snapshots_node_time ON snapshots(node_id, received_at DESC);

CREATE INDEX idx_snapshots_time ON snapshots(received_at);

CREATE TABLE ip_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  ip TEXT NOT NULL,
  asn INTEGER,
  org TEXT,
  country TEXT,
  approved INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_ip_history_node_time ON ip_history(node_id, observed_at DESC);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE dashboard_login_tokens (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX idx_dashboard_login_tokens_expires ON dashboard_login_tokens(expires_at);

CREATE TABLE metric_samples (
  reported_at INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  boot_id TEXT NOT NULL,
  cpu_percent REAL NOT NULL,
  memory_used_percent REAL NOT NULL,
  disk_used_percent REAL NOT NULL,
  inode_used_percent REAL NOT NULL,
  load1 REAL NOT NULL,
  load5 REAL NOT NULL,
  load15 REAL NOT NULL,
  swap_used_percent REAL NOT NULL,
  network_rx_bytes INTEGER NOT NULL,
  network_tx_bytes INTEGER NOT NULL,
  network_rx_rate_bps REAL,
  network_tx_rate_bps REAL,
  network_rx_errors INTEGER NOT NULL,
  network_tx_errors INTEGER NOT NULL,
  network_rx_drops INTEGER NOT NULL,
  network_tx_drops INTEGER NOT NULL,
  PRIMARY KEY (reported_at, node_id)
) WITHOUT ROWID;

CREATE TABLE probe_rounds (
  round_at INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  probes_json TEXT NOT NULL,
  PRIMARY KEY (round_at, node_id)
) WITHOUT ROWID;

CREATE TABLE metric_series_rollups (
  node_id TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  resolution TEXT NOT NULL CHECK (resolution IN ('hour', 'day')),
  bucket INTEGER NOT NULL,
  samples INTEGER NOT NULL,
  average REAL NOT NULL,
  minimum REAL NOT NULL,
  maximum REAL NOT NULL,
  p50 REAL NOT NULL,
  p95 REAL NOT NULL,
  PRIMARY KEY (node_id, metric_key, resolution, bucket)
);

CREATE INDEX idx_metric_series_rollups_time ON metric_series_rollups(resolution, bucket);

CREATE TABLE probe_series_rollups (
  node_id TEXT NOT NULL,
  probe_name TEXT NOT NULL,
  resolution TEXT NOT NULL CHECK (resolution IN ('hour', 'day')),
  bucket INTEGER NOT NULL,
  rounds INTEGER NOT NULL,
  successes INTEGER NOT NULL,
  latency_average REAL,
  latency_minimum REAL,
  latency_maximum REAL,
  latency_p50 REAL,
  latency_p95 REAL,
  jitter_average REAL,
  jitter_maximum REAL,
  successful_sample_percent REAL NOT NULL,
  sample_coverage_percent REAL NOT NULL DEFAULT 100
    CHECK (sample_coverage_percent BETWEEN 0 AND 100),
  PRIMARY KEY (node_id, probe_name, resolution, bucket)
);

CREATE INDEX idx_probe_series_rollups_time ON probe_series_rollups(resolution, bucket);

CREATE TABLE observability_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  dedup_key TEXT NOT NULL UNIQUE
);

CREATE INDEX idx_observability_events_time ON observability_events(occurred_at DESC);

INSERT INTO metric_catalog(
  metric_key, display_name, unit, category, warning_value,
  critical_value, display_order, default_visible
) VALUES
  ('cpu_percent', 'CPU', '%', 'resource', 80, 90, 10, 1),
  ('memory_used_percent', '内存', '%', 'resource', 85, 95, 20, 1),
  ('disk_used_percent', '磁盘', '%', 'resource', 85, 95, 30, 1),
  ('inode_used_percent', 'inode', '%', 'resource', 85, 95, 40, 0),
  ('load1', '1分钟负载', '', 'load', NULL, NULL, 50, 0),
  ('network_rx_rate_bps', '实时下载', 'B/s', 'network', NULL, NULL, 60, 1),
  ('network_tx_rate_bps', '实时上传', 'B/s', 'network', NULL, NULL, 70, 1);

INSERT INTO settings(key, value, updated_at) VALUES ('database_schema', 'lume-1', 0);
