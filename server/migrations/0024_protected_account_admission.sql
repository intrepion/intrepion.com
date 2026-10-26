-- Preserve the initial identity/access state as well as subsequent changes.
CREATE TRIGGER record_account_admission AFTER INSERT ON pilot_accounts
WHEN (SELECT replaying FROM security_replay_control WHERE id=1)=0 AND (SELECT enabled FROM site_safety_policy WHERE id=1)=1 BEGIN
 INSERT INTO site_security_outbox(scope,subject,public_id,active) VALUES('account_access',NEW.subject,NEW.public_id,NEW.approved);
END;
