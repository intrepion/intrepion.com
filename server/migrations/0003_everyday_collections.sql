CREATE TABLE collections (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_sub TEXT NOT NULL,
  id TEXT NOT NULL,
  kind INTEGER NOT NULL CHECK(kind BETWEEN 1 AND 4),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=10000),
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN(0,1)),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN(0,1)),
  trashed INTEGER NOT NULL DEFAULT 0 CHECK(trashed IN(0,1)),
  finished INTEGER NOT NULL DEFAULT 0 CHECK(finished IN(0,1)),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  source_id TEXT NOT NULL DEFAULT '',
  source_title TEXT NOT NULL DEFAULT '',
  last_operation TEXT NOT NULL,
  UNIQUE(owner_sub,id)
);
CREATE INDEX collection_listing ON collections(owner_sub,trashed,archived,kind,title COLLATE NOCASE,id);
CREATE TABLE collection_operations (
  owner_sub TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  PRIMARY KEY(owner_sub,operation_id)
);
CREATE TABLE collection_history (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_sub TEXT NOT NULL,
  collection_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_title TEXT NOT NULL,
  action TEXT NOT NULL,
  occurred_at INTEGER NOT NULL DEFAULT (unixepoch()),
  before_json TEXT NOT NULL CHECK(json_valid(before_json)),
  after_json TEXT NOT NULL CHECK(json_valid(after_json)),
  UNIQUE(owner_sub,operation_id,target_id)
);
CREATE INDEX collection_history_order ON collection_history(owner_sub,collection_id,sequence DESC);
