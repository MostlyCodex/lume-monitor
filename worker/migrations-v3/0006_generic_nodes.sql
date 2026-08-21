PRAGMA foreign_keys = OFF;

-- Replace the fixed v3 catalogs with the generic v4 catalogs while preserving
-- display identities, probe names, routes and all historical measurements.
ALTER TABLE business_routes RENAME TO business_routes_v3;
ALTER TABLE probe_catalog RENAME TO probe_catalog_v3;
ALTER TABLE node_catalog RENAME TO node_catalog_v3;

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
  updated_at INTEGER NOT NULL,
  service_name TEXT NOT NULL DEFAULT '',
  service_label TEXT NOT NULL DEFAULT ''
);

INSERT INTO node_catalog(
  node_id, public_id, display_name, short_mark, role_label, group_name,
  region_label, stale_seconds, display_order, color_key,
  offline_severity, ip_change_severity, enabled, updated_at,
  service_name, service_label
)
SELECT
  node_id, public_id, display_name, short_mark, role_label, group_name,
  region_label, stale_seconds, display_order, color_key,
  'P1', 'P2', enabled, updated_at, service_name, service_label
FROM node_catalog_v3;

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

INSERT INTO service_catalog(
  node_id, service_name, display_name, severity, display_order, enabled, updated_at
)
SELECT node_id, service_name, service_label, 'P1', 10, enabled, updated_at
FROM node_catalog_v3
WHERE service_name <> '';

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

INSERT INTO probe_catalog(
  node_id, probe_name, public_id, display_name, category, target_node_id,
  warning_ms, critical_ms, severity, display_order, is_primary, enabled, updated_at
)
SELECT
  probe.node_id,
  probe.probe_name,
  probe.public_id,
  probe.display_name,
  CASE WHEN route.target_node_id IS NOT NULL THEN 'node-link' ELSE probe.category END,
  route.target_node_id,
  probe.warning_ms,
  probe.critical_ms,
  'P2',
  probe.display_order,
  probe.is_primary,
  probe.enabled,
  unixepoch()
FROM probe_catalog_v3 AS probe
LEFT JOIN business_routes_v3 AS route
  ON route.source_node_id = probe.node_id
  AND route.probe_name = probe.probe_name
  AND route.enabled = 1;

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

INSERT INTO business_routes(
  route_key, display_name, source_node_id, target_node_id, probe_name,
  target_label, warning_ms, critical_ms, display_order, enabled, updated_at
)
SELECT
  route_key, display_name, source_node_id, target_node_id, probe_name,
  target_label, warning_ms, critical_ms, display_order, enabled, unixepoch()
FROM business_routes_v3;

CREATE INDEX idx_business_routes_order
  ON business_routes(enabled, display_order, display_name);

DROP TABLE business_routes_v3;
DROP TABLE probe_catalog_v3;
DROP TABLE node_catalog_v3;

-- Remove fixed node-id CHECK constraints and obsolete role columns from the
-- current-state and history tables without dropping any rows.
ALTER TABLE node_latest RENAME TO node_latest_v3;
CREATE TABLE node_latest (
  node_id TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT '',
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
INSERT INTO node_latest(
  node_id, role, received_at, reported_at, source_ip, source_asn, source_org,
  source_country, source_colo, approved_ip, last_boot_id, report_json
)
SELECT
  node_id, role, received_at, reported_at, source_ip, source_asn, source_org,
  source_country, source_colo, approved_ip, last_boot_id, report_json
FROM node_latest_v3;
DROP TABLE node_latest_v3;

ALTER TABLE snapshots RENAME TO snapshots_v3;
DROP INDEX idx_snapshots_node_time;
DROP INDEX idx_snapshots_time;
CREATE TABLE snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  received_at INTEGER NOT NULL,
  reported_at INTEGER NOT NULL,
  source_ip TEXT,
  report_json TEXT NOT NULL
);
INSERT INTO snapshots(id, node_id, role, received_at, reported_at, source_ip, report_json)
SELECT id, node_id, role, received_at, reported_at, source_ip, report_json
FROM snapshots_v3;
DROP TABLE snapshots_v3;
CREATE INDEX idx_snapshots_node_time ON snapshots(node_id, received_at DESC);
CREATE INDEX idx_snapshots_time ON snapshots(received_at);

ALTER TABLE metric_rollups RENAME TO metric_rollups_v3;
DROP INDEX idx_metric_rollups_bucket;
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
INSERT INTO metric_rollups
SELECT * FROM metric_rollups_v3;
DROP TABLE metric_rollups_v3;
CREATE INDEX idx_metric_rollups_bucket ON metric_rollups(bucket);

ALTER TABLE probe_rollups RENAME TO probe_rollups_v3;
DROP INDEX idx_probe_rollups_bucket;
CREATE TABLE probe_rollups (
  node_id TEXT NOT NULL,
  probe_name TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  samples INTEGER NOT NULL,
  successes INTEGER NOT NULL,
  duration_success_sum REAL NOT NULL,
  PRIMARY KEY (node_id, probe_name, bucket)
);
INSERT INTO probe_rollups
SELECT * FROM probe_rollups_v3;
DROP TABLE probe_rollups_v3;
CREATE INDEX idx_probe_rollups_bucket ON probe_rollups(bucket);

PRAGMA foreign_keys = ON;
PRAGMA optimize;
