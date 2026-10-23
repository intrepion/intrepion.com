-- Content-free outbox survives membership loss and retries provider uncertainty.
CREATE TABLE household_lifecycle (
  household_id TEXT PRIMARY KEY REFERENCES households(id),
  actor_sub TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  erase_due_at INTEGER NOT NULL CHECK(erase_due_at>0),
  closure_published INTEGER NOT NULL DEFAULT 0 CHECK(closure_published IN(0,1))
);
-- A closure remains final even when a recovered archive predates creation.
CREATE TABLE closed_household_ids (
  id TEXT PRIMARY KEY,
  erase_due_at INTEGER NOT NULL CHECK(erase_due_at>0)
);
CREATE TRIGGER no_closed_household_insert BEFORE INSERT ON households
WHEN EXISTS(SELECT 1 FROM closed_household_ids WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'household closure is final'); END;
CREATE TRIGGER no_household_reopening BEFORE UPDATE OF status ON households
WHEN NEW.status='active' AND (OLD.status<>'active' OR EXISTS(SELECT 1 FROM closed_household_ids WHERE id=NEW.id))
BEGIN SELECT RAISE(ABORT,'household closure is final'); END;
ALTER TABLE closed_household_ids ADD COLUMN erased INTEGER NOT NULL DEFAULT 0 CHECK(erased IN(0,1));
-- Private content-free acknowledgments are visible only to the contributing user.
CREATE TABLE household_releases (
  household_id TEXT NOT NULL REFERENCES households(id),
  subject TEXT NOT NULL REFERENCES pilot_accounts(subject),
  released_at INTEGER NOT NULL,
  PRIMARY KEY(household_id,subject)
);
