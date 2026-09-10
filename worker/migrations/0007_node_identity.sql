-- Remove the obsolete display abbreviation in place. IDs, policies, indexes,
-- retirement state and historical measurements remain unchanged.
ALTER TABLE node_catalog DROP COLUMN short_mark;

-- Existing report archives use the same metadata schema as current reports.
UPDATE node_latest
SET report_json = json_remove(report_json, '$.node.short_mark')
WHERE json_valid(report_json) AND json_type(report_json, '$.node.short_mark') IS NOT NULL;

UPDATE snapshots
SET report_json = json_remove(report_json, '$.node.short_mark')
WHERE json_valid(report_json) AND json_type(report_json, '$.node.short_mark') IS NOT NULL;
