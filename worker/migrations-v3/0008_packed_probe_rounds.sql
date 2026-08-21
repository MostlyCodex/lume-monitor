-- Store one compact row per node and probe round. The time-leading primary
-- key supports retention and rollup scans without a second write-amplifying
-- index. Existing probe_samples_v2 data remains readable during retention.
CREATE TABLE probe_rounds_v3 (
  round_at INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  probes_json TEXT NOT NULL,
  PRIMARY KEY (round_at, node_id)
) WITHOUT ROWID;

-- Resource history uses the same time-leading WITHOUT ROWID layout. This
-- replaces the row table + primary-key index + time index write pattern.
CREATE TABLE metric_samples_v3 (
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

-- Reuse the already-updated latest-state row for recent replay protection and
-- current rates instead of writing a separate nonce row on every report.
ALTER TABLE node_latest ADD COLUMN recent_nonces_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE node_latest ADD COLUMN network_rx_rate_bps REAL;
ALTER TABLE node_latest ADD COLUMN network_tx_rate_bps REAL;

PRAGMA optimize;
