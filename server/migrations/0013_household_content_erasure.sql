-- Immutable identifier-only manifests. Completed rows are content-free receipts.
CREATE TABLE household_content_erasures (
 household_id TEXT NOT NULL REFERENCES households(id),
 operation_id TEXT NOT NULL,
 actor_sub TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 expected_revision INTEGER NOT NULL,
 target_json TEXT NOT NULL CHECK(json_valid(target_json) AND json_type(target_json)='array'),
 published_batches INTEGER NOT NULL DEFAULT 0 CHECK(published_batches>=0),
 completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN(0,1)),
 PRIMARY KEY(household_id,operation_id)
);
CREATE UNIQUE INDEX one_pending_household_erasure ON household_content_erasures(household_id) WHERE completed=0;
CREATE TRIGGER content_erasure_requires_unused_operation BEFORE INSERT ON household_content_erasures
WHEN EXISTS(SELECT 1 FROM household_operations WHERE actor_sub=NEW.actor_sub AND operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'Operation already acknowledged'); END;
CREATE TRIGGER household_receipt_requires_matching_erasure BEFORE INSERT ON household_operations
WHEN EXISTS(SELECT 1 FROM household_content_erasures WHERE actor_sub=NEW.actor_sub AND operation_id=NEW.operation_id AND (fingerprint<>NEW.fingerprint OR household_id<>NEW.household_id))
BEGIN SELECT RAISE(ABORT,'Operation reserved for shared-content erasure'); END;
