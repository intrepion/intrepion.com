CREATE TABLE tasks (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL,
  owner_sub TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 10000),
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 1,
  UNIQUE(owner_sub, id)
);
CREATE INDEX task_order ON tasks(owner_sub, completed, sequence DESC);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  owner_sub TEXT NOT NULL,
  csrf TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX session_expiry ON sessions(expires_at);
CREATE TABLE login_challenges (
  nonce_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
