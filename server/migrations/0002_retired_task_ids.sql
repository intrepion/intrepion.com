-- Keep only identities, never task text, so delayed create retries cannot undo deletion.
CREATE TABLE retired_task_ids (
  owner_sub TEXT NOT NULL,
  id TEXT NOT NULL,
  PRIMARY KEY(owner_sub, id)
);
CREATE TRIGGER remember_deleted_task AFTER DELETE ON tasks
BEGIN
  INSERT OR IGNORE INTO retired_task_ids(owner_sub, id) VALUES(OLD.owner_sub, OLD.id);
END;
