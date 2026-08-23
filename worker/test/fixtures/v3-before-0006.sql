PRAGMA foreign_keys = OFF;

-- Privacy-free representation of the production schema immediately before
-- migrations-v3/0006. Only the compatibility surface used by 0006-0009 is
-- reproduced; no live node identity or measurement is included.
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
  enabled INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  service_name TEXT NOT NULL,
  service_label TEXT NOT NULL
);

CREATE TABLE probe_catalog (
  node_id TEXT NOT NULL,
  probe_name TEXT NOT NULL,
  public_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  warning_ms REAL,
  critical_ms REAL,
  display_order INTEGER NOT NULL,
  is_primary INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  PRIMARY KEY (node_id, probe_name)
);

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
  enabled INTEGER NOT NULL
);

CREATE TABLE node_latest (
  node_id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
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
  role TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  reported_at INTEGER NOT NULL,
  source_ip TEXT,
  report_json TEXT NOT NULL
);
CREATE INDEX idx_snapshots_node_time ON snapshots(node_id, received_at DESC);
CREATE INDEX idx_snapshots_time ON snapshots(received_at);

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

CREATE TABLE probe_samples_v2 (
  node_id TEXT NOT NULL,
  probe_name TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  success INTEGER NOT NULL,
  duration_ms REAL NOT NULL,
  min_duration_ms REAL,
  max_duration_ms REAL,
  jitter_ms REAL,
  samples INTEGER NOT NULL,
  successful_samples INTEGER NOT NULL,
  PRIMARY KEY (node_id, probe_name, checked_at)
);

CREATE TABLE probe_series_rollups (
  node_id TEXT NOT NULL,
  probe_name TEXT NOT NULL,
  resolution TEXT NOT NULL,
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

INSERT INTO node_catalog VALUES (
  'legacy-fixture', 'legacy-fixture', 'Legacy Fixture', 'LEG', 'Legacy',
  'test', 'Test Region', 180, 999, 'gray', 0, 1700000000, '', ''
);
INSERT INTO node_latest VALUES (
  'legacy-fixture', 'legacy', 1700000000, 1700000000, NULL, NULL, NULL,
  NULL, NULL, NULL, 'legacy-boot-id', '{}'
);
INSERT INTO snapshots(
  node_id, role, received_at, reported_at, source_ip, report_json
) VALUES ('legacy-fixture', 'legacy', 1700000000, 1700000000, NULL, '{}');

PRAGMA foreign_keys = ON;
