-- The release must migrate before starting the new API. Never run the old API
-- after this migration: its writes are blocked below rather than silently lost.
INSERT INTO collections(owner_sub,id,kind,title,notes,completed,revision,last_operation)
SELECT owner_sub,id,1,title,notes,completed,revision,'migration:'||id FROM tasks ORDER BY sequence;
INSERT INTO collection_history(owner_sub,collection_id,operation_id,target_id,target_title,action,before_json,after_json)
SELECT owner_sub,id,'migration:'||id,id,title,'Existing task at MVP 2 migration','null',
json_object('title',title,'notes',notes,'completed',json(CASE completed WHEN 1 THEN 'true' ELSE 'false' END))
FROM tasks;
-- Only the canonical collection retains the content. Keeping a stale second
-- copy here would defeat later permanent erasure. The original retirement
-- trigger records only identifiers and remains available for legacy recovery.
DELETE FROM tasks;
CREATE TRIGGER tasks_replaced_insert BEFORE INSERT ON tasks BEGIN
  SELECT RAISE(ABORT,'MVP 2 requires the current API');
END;
CREATE TRIGGER tasks_replaced_update BEFORE UPDATE ON tasks BEGIN
  SELECT RAISE(ABORT,'MVP 2 requires the current API');
END;
CREATE TRIGGER tasks_replaced_delete BEFORE DELETE ON tasks BEGIN
  SELECT RAISE(ABORT,'MVP 2 requires the current API');
END;
