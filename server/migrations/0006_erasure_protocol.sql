-- Ledger replay is scoped to a database and stable identifiers, independent of
-- a Google-owner transfer. These identifiers must not collide between owners.
CREATE UNIQUE INDEX global_collection_ids ON collections(id);
CREATE UNIQUE INDEX global_item_ids ON list_items(id);
CREATE UNIQUE INDEX global_section_ids ON list_sections(id);
CREATE TABLE retired_list_ids (
  kind TEXT NOT NULL CHECK(kind IN('collection','item','section')),
  id TEXT NOT NULL,
  PRIMARY KEY(kind,id)
);
CREATE TABLE erasure_intents (
  owner_sub TEXT NOT NULL,
  collection_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  fingerprint TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  target_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN('collection','item'))
);
ALTER TABLE collection_operations ADD COLUMN erased_scope TEXT NOT NULL DEFAULT '' CHECK(erased_scope IN('','collection','item'));
-- Reserve action identities across publication. These constraints also close
-- races between a normal transaction and another collection's erasure intent.
CREATE TRIGGER intent_requires_unused_operation BEFORE INSERT ON erasure_intents
WHEN EXISTS(SELECT 1 FROM collection_operations WHERE owner_sub=NEW.owner_sub AND operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'Operation already acknowledged'); END;
CREATE TRIGGER receipt_requires_matching_intent BEFORE INSERT ON collection_operations
WHEN EXISTS(SELECT 1 FROM erasure_intents WHERE owner_sub=NEW.owner_sub AND operation_id=NEW.operation_id AND (collection_id<>NEW.collection_id OR fingerprint<>NEW.fingerprint OR scope<>NEW.erased_scope))
BEGIN SELECT RAISE(ABORT,'Operation reserved for erasure'); END;
CREATE TRIGGER no_retired_collection BEFORE INSERT ON collections
WHEN EXISTS(SELECT 1 FROM retired_list_ids WHERE kind='collection' AND id=NEW.id)
BEGIN SELECT RAISE(ABORT,'Identifier retired'); END;
CREATE TRIGGER no_retired_item BEFORE INSERT ON list_items
WHEN EXISTS(SELECT 1 FROM retired_list_ids WHERE kind='item' AND id=NEW.id)
BEGIN SELECT RAISE(ABORT,'Identifier retired'); END;
CREATE TRIGGER no_retired_section BEFORE INSERT ON list_sections
WHEN EXISTS(SELECT 1 FROM retired_list_ids WHERE kind='section' AND id=NEW.id)
BEGIN SELECT RAISE(ABORT,'Identifier retired'); END;
-- History identifies its target by stable UUID. Prevent cross-kind aliases too.
CREATE TABLE identity_check(id TEXT PRIMARY KEY);
INSERT INTO identity_check(id) SELECT id FROM collections;
INSERT INTO identity_check(id) SELECT id FROM list_items;
INSERT INTO identity_check(id) SELECT id FROM list_sections;
DROP TABLE identity_check;
CREATE TRIGGER distinct_collection_identity BEFORE INSERT ON collections
WHEN EXISTS(SELECT 1 FROM list_items WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM list_sections WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'Identity belongs to another entity kind'); END;
CREATE TRIGGER distinct_item_identity BEFORE INSERT ON list_items
WHEN EXISTS(SELECT 1 FROM collections WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM list_sections WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'Identity belongs to another entity kind'); END;
CREATE TRIGGER distinct_section_identity BEFORE INSERT ON list_sections
WHEN EXISTS(SELECT 1 FROM collections WHERE id=NEW.id) OR EXISTS(SELECT 1 FROM list_items WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'Identity belongs to another entity kind'); END;
