-- Operator retirement is separate from agent-reported liveness.
--
-- `enabled` stays owned by the report path: every accepted report re-enables the
-- rows it still describes, which is what keeps the catalog self-healing. That
-- made `enabled` unusable as an operator decision, because a node that was
-- disabled by hand came back on its next report.
--
-- `retired_at` is owned by the operator instead. No report ever sets or clears
-- it, so retiring a node is order independent and idempotent: it can be done
-- before or after the agent is stopped and it never flips back.
ALTER TABLE node_catalog ADD COLUMN retired_at INTEGER;

DROP INDEX IF EXISTS idx_node_catalog_order;
CREATE INDEX idx_node_catalog_order
  ON node_catalog(enabled, retired_at, display_order, display_name);

PRAGMA optimize;
