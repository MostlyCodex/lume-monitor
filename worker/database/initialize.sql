PRAGMA foreign_keys = ON;

-- Node, service and probe catalogs are populated from authenticated Agent reports.
-- No node identity or topology is compiled into the Worker or seeded here.
CREATE TABLE node_catalog (
  node_id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  short_mark TEXT NOT NULL,
  role_label TEXT NOT NULL,
  group_name TEXT NOT NULL,
  region_label TEXT NOT NULL,
  stale_seconds INTEGER NOT NULL,
  display_order INTEGER NOT NULL,
  color_key TEXT NOT NULL,
  offline_severity TEXT NOT NULL CHECK (offline_severity IN ('P1', 'P2', 'INFO')),
  ip_change_severity TEXT NOT NULL CHECK (ip_change_severity IN ('P1', 'P2', 'INFO')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_node_catalog_order ON node_catalog(enabled, display_order, display_name);

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
  target_node_id TEXT,
  warning_ms REAL,
  critical_ms REAL,
  severity TEXT NOT NULL CHECK (severity IN ('P1', 'P2', 'INFO')),
  display_order INTEGER NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (node_id, probe_name)
);

CREATE INDEX idx_probe_catalog_order ON probe_catalog(node_id, enabled, display_order, display_name);

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
  report_json TEXT NOT NULL
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

CREATE TABLE alerts (
  alert_key TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('P1', 'P2', 'INFO')),
  state TEXT NOT NULL CHECK (state IN ('pending', 'firing', 'recovering', 'resolved')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  consecutive_successes INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  last_notified INTEGER,
  resolved_at INTEGER,
  details_json TEXT NOT NULL
);

CREATE INDEX idx_alerts_state ON alerts(state, severity, last_seen DESC);

CREATE TABLE alert_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_key TEXT NOT NULL,
  node_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  event_type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  details_json TEXT NOT NULL,
  telegram_sent INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_alert_events_time ON alert_events(created_at DESC);

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

CREATE TABLE ingest_dedup (
  node_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (node_id, nonce)
);

CREATE INDEX idx_ingest_dedup_time ON ingest_dedup(received_at);

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

CREATE TABLE metric_rollups (
  node_id TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  samples INTEGER NOT NULL,
  cpu_sum REAL NOT NULL,
  memory_used_sum REAL NOT NULL,
  disk_used_sum REAL NOT NULL,
  inode_used_sum REAL NOT NULL,
  network_rx_max INTEGER NOT NULL,
  network_tx_max INTEGER NOT NULL,
  PRIMARY KEY (node_id, bucket)
);

CREATE INDEX idx_metric_rollups_bucket ON metric_rollups(bucket);

CREATE TABLE probe_rollups (
  node_id TEXT NOT NULL,
  probe_name TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  samples INTEGER NOT NULL,
  successes INTEGER NOT NULL,
  duration_success_sum REAL NOT NULL,
  PRIMARY KEY (node_id, probe_name, bucket)
);

CREATE INDEX idx_probe_rollups_bucket ON probe_rollups(bucket);

CREATE TABLE probe_sample_dedup (
  node_id TEXT NOT NULL,
  probe_name TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  claim_id TEXT NOT NULL,
  ingested_at INTEGER NOT NULL,
  PRIMARY KEY (node_id, probe_name, checked_at)
);

CREATE INDEX idx_probe_sample_dedup_time ON probe_sample_dedup(ingested_at);

CREATE TABLE metric_samples_v2 (
  node_id TEXT NOT NULL,
  reported_at INTEGER NOT NULL,
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
  PRIMARY KEY (node_id, reported_at)
);

CREATE INDEX idx_metric_samples_v2_time ON metric_samples_v2(reported_at);

CREATE TABLE probe_samples_v2 (
  node_id TEXT NOT NULL,
  probe_name TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  success INTEGER NOT NULL CHECK (success IN (0, 1)),
  duration_ms REAL NOT NULL,
  min_duration_ms REAL,
  max_duration_ms REAL,
  jitter_ms REAL,
  samples INTEGER NOT NULL,
  successful_samples INTEGER NOT NULL,
  PRIMARY KEY (node_id, probe_name, checked_at)
);

CREATE INDEX idx_probe_samples_v2_time ON probe_samples_v2(checked_at);
CREATE INDEX idx_probe_samples_v2_series ON probe_samples_v2(node_id, probe_name, checked_at);

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

PRAGMA optimize;
