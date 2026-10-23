ALTER TABLE pilot_accounts ADD COLUMN public_id TEXT NOT NULL DEFAULT '';
UPDATE pilot_accounts SET public_id=lower(hex(randomblob(16)));
CREATE UNIQUE INDEX account_public_identity ON pilot_accounts(public_id) WHERE public_id<>'';
CREATE TABLE households (
  id TEXT PRIMARY KEY,
  scope_sub TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','closed','erasing','erased')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_by TEXT NOT NULL REFERENCES pilot_accounts(subject),
  last_operation TEXT NOT NULL,
  erase_due_at INTEGER NOT NULL DEFAULT 0,
  erasure_delayed INTEGER NOT NULL DEFAULT 0 CHECK(erasure_delayed IN(0,1))
);
CREATE TABLE household_heads (
  household_id TEXT NOT NULL REFERENCES households(id),
  subject TEXT NOT NULL REFERENCES pilot_accounts(subject),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
  ceilings_json TEXT NOT NULL CHECK(json_valid(ceilings_json)),
  PRIMARY KEY(household_id,subject)
);
CREATE INDEX head_memberships ON household_heads(subject,active,household_id);
CREATE TABLE household_allocations (
  household_id TEXT NOT NULL REFERENCES households(id),
  subject TEXT NOT NULL REFERENCES pilot_accounts(subject),
  amounts_json TEXT NOT NULL CHECK(json_valid(amounts_json)),
  PRIMARY KEY(household_id,subject)
);
CREATE INDEX account_allocations ON household_allocations(subject,household_id);
CREATE TABLE household_invitations (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  recipient_sub TEXT NOT NULL REFERENCES pilot_accounts(subject),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','accepted','revoked')),
  expires_at INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES pilot_accounts(subject)
);
CREATE INDEX household_invitation_listing ON household_invitations(household_id,id);
CREATE TABLE household_operations (
  actor_sub TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  household_id TEXT NOT NULL,
  result_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(actor_sub,operation_id)
);
CREATE TABLE household_activity (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  household_id TEXT NOT NULL REFERENCES households(id),
  actor_sub TEXT NOT NULL,
  action TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details_json)),
  occurred_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX household_activity_order ON household_activity(household_id,sequence DESC);
-- A failed final check aborts the entire D1 batch; successful batches leave no rows.
CREATE TABLE invariant_guards (valid INTEGER NOT NULL CHECK(valid=1));
ALTER TABLE collections ADD COLUMN creator_sub TEXT NOT NULL DEFAULT '';
ALTER TABLE list_items ADD COLUMN creator_sub TEXT NOT NULL DEFAULT '';
ALTER TABLE collection_history ADD COLUMN actor_sub TEXT NOT NULL DEFAULT '';
UPDATE collections SET creator_sub=owner_sub;
UPDATE list_items SET creator_sub=owner_sub;
UPDATE collection_history SET actor_sub=owner_sub;
CREATE INDEX collection_creator_usage ON collections(owner_sub,creator_sub,kind);
CREATE INDEX item_creator_usage ON list_items(owner_sub,creator_sub);
-- Logical customer bytes: retained user text plus content History values, in UTF-8.
-- Identifiers, provider/index overhead, sessions and content-free safety records are excluded.
CREATE VIEW space_usage AS
WITH scopes AS (
 SELECT subject AS owner_sub FROM pilot_accounts
 UNION SELECT owner_sub FROM collections
 UNION SELECT scope_sub FROM households WHERE status<>'erased'
)
SELECT owner_sub,
 (SELECT count(*) FROM collections c WHERE c.owner_sub=scopes.owner_sub AND kind=1)
 +(SELECT count(*) FROM list_items i WHERE i.owner_sub=scopes.owner_sub) AS items,
 (SELECT count(*) FROM collections c WHERE c.owner_sub=scopes.owner_sub AND kind=2) AS shopping,
 (SELECT count(*) FROM collections c WHERE c.owner_sub=scopes.owner_sub AND kind=3) AS templates,
 (SELECT count(*) FROM collections c WHERE c.owner_sub=scopes.owner_sub AND kind=4) AS runs,
 (SELECT coalesce(sum(length(CAST(name AS BLOB))),0) FROM households h WHERE h.scope_sub=scopes.owner_sub AND h.status<>'erased')
 +(SELECT coalesce(sum(length(CAST(title AS BLOB))+length(CAST(notes AS BLOB))+length(CAST(source_title AS BLOB))),0) FROM collections c WHERE c.owner_sub=scopes.owner_sub)
 +(SELECT coalesce(sum(length(CAST(title AS BLOB))),0) FROM list_sections x WHERE x.owner_sub=scopes.owner_sub)
 +(SELECT coalesce(sum(length(CAST(title AS BLOB))+length(CAST(notes AS BLOB))+length(CAST(quantity AS BLOB))),0) FROM list_items i WHERE i.owner_sub=scopes.owner_sub)
 +(SELECT coalesce(sum(length(CAST(target_title AS BLOB))+length(CAST(before_json AS BLOB))+length(CAST(after_json AS BLOB))),0) FROM collection_history e WHERE e.owner_sub=scopes.owner_sub) AS bytes,
 0 AS households
FROM scopes;
