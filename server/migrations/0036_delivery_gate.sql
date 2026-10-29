CREATE TABLE delivery_handoff_gate (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  token TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO delivery_handoff_gate(id) VALUES(1);
