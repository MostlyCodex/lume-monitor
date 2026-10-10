-- Current Lume database. Initialize an empty D1 database through the management tool.
-- Node catalogs are populated by authenticated reports; no node data is seeded.

CREATE TABLE node_catalog (
  node_id TEXT PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role_label TEXT NOT NULL,
  region_label TEXT NOT NULL,
  stale_seconds INTEGER NOT NULL,
  display_order INTEGER NOT NULL,
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
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (node_id, probe_name)
);

CREATE INDEX idx_probe_catalog_order
  ON probe_catalog(node_id, enabled, display_order, display_name);

CREATE TABLE node_latest (
  node_id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL,
  reported_at INTEGER NOT NULL,
  source_ip TEXT,
  source_country TEXT,
  last_boot_id TEXT,
  report_json TEXT NOT NULL,
  recent_nonces_json TEXT NOT NULL DEFAULT '[]',
  network_rx_rate_bps REAL,
  network_tx_rate_bps REAL
);

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
  network_rx_rate_bps REAL,
  network_tx_rate_bps REAL,
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
  bucket INTEGER NOT NULL,
  network_rx_rate_bps REAL,
  network_tx_rate_bps REAL,
  PRIMARY KEY (node_id, bucket)
);

CREATE INDEX idx_metric_series_rollups_time ON metric_series_rollups(bucket);

CREATE TABLE probe_series_rollups (
  node_id TEXT NOT NULL,
  probe_name TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  rounds INTEGER NOT NULL,
  successes INTEGER NOT NULL,
  latency_average REAL,
  successful_sample_percent REAL NOT NULL,
  PRIMARY KEY (node_id, probe_name, bucket)
);

CREATE INDEX idx_probe_series_rollups_time ON probe_series_rollups(bucket);

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

INSERT INTO settings(key, value, updated_at) VALUES ('database_schema', 'lume-2', 0);
