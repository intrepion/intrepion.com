ALTER TABLE pilot_accounts ADD COLUMN last_policy_operation TEXT NOT NULL DEFAULT '';
ALTER TABLE operator_settings ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operator_settings ADD COLUMN last_operation TEXT NOT NULL DEFAULT '';
CREATE TABLE pilot_operator_operations (
 operation_id TEXT PRIMARY KEY,
 fingerprint TEXT NOT NULL,
 subject TEXT NOT NULL,
 public_id TEXT NOT NULL,
 revision INTEGER NOT NULL,
 max_items INTEGER NOT NULL DEFAULT 0,
 max_sections INTEGER NOT NULL DEFAULT 0
);
