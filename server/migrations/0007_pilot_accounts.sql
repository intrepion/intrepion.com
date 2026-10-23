-- Google subjects are operator-approved identities, not user-selected account IDs.
CREATE TABLE pilot_accounts (
  subject TEXT PRIMARY KEY CHECK(length(subject) BETWEEN 1 AND 255),
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 100),
  approved INTEGER NOT NULL DEFAULT 1 CHECK(approved IN(0,1)),
  plan_json TEXT NOT NULL DEFAULT '{"items":0,"shopping":0,"templates":0,"runs":0,"bytes":0,"households":0}' CHECK(json_valid(plan_json)),
  plan_revision INTEGER NOT NULL DEFAULT 0 CHECK(plan_revision>=0)
);
-- Existing content stays personal; retain the original Google subject and History.
INSERT INTO pilot_accounts(subject,display_name)
SELECT owner_sub,'Owner' FROM collections UNION SELECT owner_sub,'Owner' FROM sessions;
