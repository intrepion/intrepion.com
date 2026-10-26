CREATE TABLE invitation_growth(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL DEFAULT 0,paused INTEGER NOT NULL DEFAULT 1 CHECK(paused IN(0,1)),last_operation TEXT NOT NULL DEFAULT '');
INSERT INTO invitation_growth(id) VALUES(1);
CREATE TABLE email_invitations(
 id TEXT PRIMARY KEY,household_id TEXT NOT NULL REFERENCES households(id),
 recipient_email TEXT NOT NULL CHECK(length(recipient_email) BETWEEN 3 AND 254),
 token_hash TEXT NOT NULL UNIQUE,generation INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','accepted','revoked')),
 delivery_status TEXT NOT NULL DEFAULT 'queued',expires_at INTEGER NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,created_by TEXT NOT NULL REFERENCES pilot_accounts(subject),
 last_operation TEXT NOT NULL,created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE UNIQUE INDEX one_pending_email_invitation ON email_invitations(household_id,recipient_email) WHERE status='pending';
CREATE INDEX email_invitation_queue ON email_invitations(status,delivery_status,expires_at);
CREATE TABLE email_invitation_operations(actor_sub TEXT NOT NULL,operation_id TEXT NOT NULL,fingerprint TEXT NOT NULL,invitation_id TEXT NOT NULL,PRIMARY KEY(actor_sub,operation_id));
CREATE TRIGGER revoke_departed_issuer_email AFTER UPDATE OF active ON household_heads WHEN OLD.active=1 AND NEW.active=0 BEGIN
 UPDATE email_invitations SET status='revoked',delivery_status='canceled',revision=revision+1 WHERE household_id=NEW.household_id AND created_by=NEW.subject AND status='pending';
END;
CREATE TRIGGER revoke_suspended_issuer_email AFTER UPDATE OF approved ON pilot_accounts WHEN OLD.approved=1 AND NEW.approved=0 BEGIN
 UPDATE email_invitations SET status='revoked',delivery_status='canceled',revision=revision+1 WHERE created_by=NEW.subject AND status='pending';
 DELETE FROM sessions WHERE owner_sub=NEW.subject;
END;
