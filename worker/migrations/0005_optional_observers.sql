-- Optional TCP probes share the packed probe round with ICMP. Optional
-- nftables counters share the existing metric row, so enabling either feature
-- does not create another time-series row per report.
DROP INDEX IF EXISTS idx_probe_catalog_order;
ALTER TABLE probe_catalog RENAME TO probe_catalog_before_optional_observers;

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

INSERT INTO probe_catalog(
  node_id, probe_name, public_id, display_name, category, kind, target_node_id,
  warning_ms, critical_ms, warning_failure_percent, critical_failure_percent,
  severity, display_order, is_primary, enabled, updated_at
)
SELECT
  node_id, probe_name, public_id, display_name, category, kind, target_node_id,
  warning_ms, critical_ms, warning_failure_percent, critical_failure_percent,
  severity, display_order, is_primary, enabled, updated_at
FROM probe_catalog_before_optional_observers;

DROP TABLE probe_catalog_before_optional_observers;
CREATE INDEX idx_probe_catalog_order
  ON probe_catalog(node_id, enabled, display_order, display_name);

CREATE TABLE counter_catalog (
  node_id TEXT NOT NULL,
  counter_name TEXT NOT NULL,
  public_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind = 'nftables-rule'),
  unit TEXT NOT NULL CHECK (unit = 'matches'),
  display_order INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (node_id, counter_name)
);
CREATE INDEX idx_counter_catalog_order
  ON counter_catalog(node_id, enabled, display_order, display_name);

ALTER TABLE metric_samples_v3 ADD COLUMN local_counters_json TEXT NOT NULL DEFAULT '[]';

PRAGMA optimize;
