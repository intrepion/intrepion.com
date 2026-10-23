-- Development and local E2E examples only. Never apply this file remotely.
-- Preserve any already configured local plan or structural policy.
UPDATE operator_settings SET max_items_per_collection=200,max_sections_per_collection=50
WHERE id=1 AND max_items_per_collection=0 AND max_sections_per_collection=0
AND NOT EXISTS(SELECT 1 FROM pilot_accounts WHERE plan_revision>0);
INSERT INTO pilot_accounts(subject,display_name,public_id) VALUES
 ('development-owner','Owner','01010101010101010101010101010101'),
 ('development-second','Morgan','02020202020202020202020202020202')
ON CONFLICT(subject) DO NOTHING;
UPDATE pilot_accounts SET plan_json='{"items":1000,"shopping":30,"templates":30,"runs":60,"bytes":2097152,"households":10}',plan_revision=1
WHERE subject IN('development-owner','development-second') AND plan_revision=0;
