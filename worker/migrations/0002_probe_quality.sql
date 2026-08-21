-- Add explicit probe semantics without changing existing node or probe IDs.
ALTER TABLE probe_catalog
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'tcp'
  CHECK (kind IN ('icmp', 'tcp', 'tls'));
ALTER TABLE probe_catalog
  ADD COLUMN warning_failure_percent REAL NOT NULL DEFAULT 0
  CHECK (warning_failure_percent BETWEEN 0 AND 100);
ALTER TABLE probe_catalog
  ADD COLUMN critical_failure_percent REAL NOT NULL DEFAULT 0
  CHECK (critical_failure_percent BETWEEN 0 AND 100);

ALTER TABLE probe_samples_v2 ADD COLUMN average_duration_ms REAL;
ALTER TABLE probe_samples_v2 ADD COLUMN p95_duration_ms REAL;
ALTER TABLE probe_samples_v2 ADD COLUMN range_ms REAL;
ALTER TABLE probe_samples_v2 ADD COLUMN attempted_samples INTEGER NOT NULL DEFAULT 1;
ALTER TABLE probe_samples_v2
  ADD COLUMN sample_failure_percent REAL NOT NULL DEFAULT 0
  CHECK (sample_failure_percent BETWEEN 0 AND 100);
ALTER TABLE probe_samples_v2
  ADD COLUMN packet_loss_percent REAL
  CHECK (packet_loss_percent IS NULL OR packet_loss_percent BETWEEN 0 AND 100);
ALTER TABLE probe_samples_v2
  ADD COLUMN complete INTEGER NOT NULL DEFAULT 1
  CHECK (complete IN (0, 1));
ALTER TABLE probe_series_rollups
  ADD COLUMN sample_coverage_percent REAL NOT NULL DEFAULT 100
  CHECK (sample_coverage_percent BETWEEN 0 AND 100);

UPDATE probe_samples_v2
SET
  average_duration_ms = duration_ms,
  p95_duration_ms = duration_ms,
  range_ms = CASE
    WHEN min_duration_ms IS NOT NULL AND max_duration_ms IS NOT NULL
      THEN MAX(0, max_duration_ms - min_duration_ms)
    ELSE 0
  END,
  attempted_samples = samples,
  sample_failure_percent = CASE
    WHEN samples > 0
      THEN 100.0 * (samples - successful_samples) / samples
    ELSE 100
  END,
  complete = 1;

PRAGMA optimize;
