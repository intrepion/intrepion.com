ALTER TABLE email_invitations ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_invitations ADD COLUMN claim_id TEXT NOT NULL DEFAULT '';
ALTER TABLE email_invitations ADD COLUMN claim_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_invitations ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0;
CREATE TABLE email_monthly_attempts(month TEXT PRIMARY KEY,attempted INTEGER NOT NULL DEFAULT 0 CHECK(attempted>=0));
CREATE TABLE email_send_attempts(id TEXT PRIMARY KEY,invitation_id TEXT NOT NULL,generation INTEGER NOT NULL,recipient_email TEXT NOT NULL,outcome TEXT NOT NULL DEFAULT 'uncertain',provider_message_id TEXT NOT NULL DEFAULT '',attempted_at INTEGER NOT NULL);
CREATE INDEX email_delivery_retention ON email_send_attempts(attempted_at);
CREATE TABLE email_suppressions(recipient_email TEXT PRIMARY KEY,reason TEXT NOT NULL,created_at INTEGER NOT NULL DEFAULT(unixepoch()));
-- Old invitation/allocation writers cannot bypass the activated normal-account model.
CREATE TRIGGER retire_legacy_invitation_writes BEFORE INSERT ON household_invitations WHEN (SELECT enabled FROM site_safety_policy WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'Legacy invitation writes are retired'); END;
CREATE TRIGGER retire_legacy_allocation_inserts BEFORE INSERT ON household_allocations WHEN (SELECT enabled FROM site_safety_policy WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'Legacy allocation writes are retired'); END;
CREATE TRIGGER retire_legacy_allocation_updates BEFORE UPDATE ON household_allocations WHEN (SELECT enabled FROM site_safety_policy WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'Legacy allocation writes are retired'); END;
CREATE TRIGGER retire_legacy_ceiling_updates BEFORE UPDATE OF ceilings_json ON household_heads WHEN (SELECT enabled FROM site_safety_policy WHERE id=1)=1 BEGIN SELECT RAISE(ABORT,'Individual head ceilings are retired'); END;
