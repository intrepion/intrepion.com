-- Prevent a pre-MVP-3 writer from adding unmetered content or History.
-- The context exists only inside a transactional, budget-checked content write.
CREATE TRIGGER budget_collections_insert BEFORE INSERT ON collections
WHEN NOT EXISTS(SELECT 1 FROM write_budgets b WHERE b.owner_sub=NEW.owner_sub AND b.collection_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'content changes require a budget-aware writer'); END;
CREATE TRIGGER budget_collections_update BEFORE UPDATE ON collections
WHEN NOT EXISTS(SELECT 1 FROM write_budgets b WHERE b.owner_sub=NEW.owner_sub AND b.collection_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'content changes require a budget-aware writer'); END;
CREATE TRIGGER budget_list_items_insert BEFORE INSERT ON list_items
WHEN NOT EXISTS(SELECT 1 FROM write_budgets b WHERE b.owner_sub=NEW.owner_sub AND b.collection_id=NEW.collection_id)
BEGIN SELECT RAISE(ABORT,'content changes require a budget-aware writer'); END;
CREATE TRIGGER budget_list_items_update BEFORE UPDATE ON list_items
WHEN NOT EXISTS(SELECT 1 FROM write_budgets b WHERE b.owner_sub=NEW.owner_sub AND b.collection_id=NEW.collection_id)
BEGIN SELECT RAISE(ABORT,'content changes require a budget-aware writer'); END;
CREATE TRIGGER budget_list_sections_insert BEFORE INSERT ON list_sections
WHEN NOT EXISTS(SELECT 1 FROM write_budgets b WHERE b.owner_sub=NEW.owner_sub AND b.collection_id=NEW.collection_id)
BEGIN SELECT RAISE(ABORT,'content changes require a budget-aware writer'); END;
CREATE TRIGGER budget_list_sections_update BEFORE UPDATE ON list_sections
WHEN NOT EXISTS(SELECT 1 FROM write_budgets b WHERE b.owner_sub=NEW.owner_sub AND b.collection_id=NEW.collection_id)
BEGIN SELECT RAISE(ABORT,'content changes require a budget-aware writer'); END;
CREATE TRIGGER budget_collection_history_insert BEFORE INSERT ON collection_history
WHEN NOT EXISTS(SELECT 1 FROM write_budgets b WHERE b.owner_sub=NEW.owner_sub AND b.collection_id=NEW.collection_id)
BEGIN SELECT RAISE(ABORT,'content changes require a budget-aware writer'); END;
CREATE TRIGGER budget_collection_history_update BEFORE UPDATE ON collection_history
WHEN NOT EXISTS(SELECT 1 FROM write_budgets b WHERE b.owner_sub=NEW.owner_sub AND b.collection_id=NEW.collection_id)
BEGIN SELECT RAISE(ABORT,'content changes require a budget-aware writer'); END;
