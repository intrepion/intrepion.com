CREATE TABLE household_request_notifications (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES household_invitation_requests(id),
 household_id TEXT NOT NULL REFERENCES households(id), head_sub TEXT NOT NULL REFERENCES pilot_accounts(subject),
 recipient_email TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,
 claim_id TEXT NOT NULL DEFAULT '',claim_until INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL DEFAULT 0,delivery_event_at INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL DEFAULT(unixepoch()),UNIQUE(request_id,head_sub)
);
CREATE INDEX request_notification_queue ON household_request_notifications(status,created_at);
CREATE TRIGGER cancel_request_notices_on_decision AFTER UPDATE OF status ON household_invitation_requests
WHEN NEW.status<>'pending' BEGIN
 UPDATE household_request_notifications SET status='canceled',claim_id='',claim_until=0 WHERE request_id=NEW.id AND status IN('queued','sending','uncertain');
END;
CREATE TRIGGER cancel_notices_on_opt_out AFTER UPDATE OF enabled,confirmed_email ON household_request_notification_settings
WHEN NEW.enabled=0 OR NEW.confirmed_email<>OLD.confirmed_email BEGIN
 UPDATE household_request_notifications SET status='canceled',claim_id='',claim_until=0 WHERE household_id=NEW.household_id AND head_sub=NEW.head_sub AND status IN('queued','sending','uncertain');
END;
CREATE TRIGGER cancel_notices_on_email_change AFTER UPDATE OF google_verified_email ON pilot_accounts
WHEN NEW.google_verified_email<>OLD.google_verified_email BEGIN
 UPDATE household_request_notifications SET status='canceled',claim_id='',claim_until=0 WHERE head_sub=NEW.subject AND status IN('queued','sending','uncertain');
END;
CREATE TRIGGER cancel_notices_on_head_departure AFTER UPDATE OF active ON household_heads
WHEN OLD.active=1 AND NEW.active=0 BEGIN
 UPDATE household_request_notifications SET status='canceled',claim_id='',claim_until=0 WHERE household_id=NEW.household_id AND head_sub=NEW.subject AND status IN('queued','sending','uncertain');
END;
CREATE TRIGGER cancel_notices_on_head_suspension AFTER UPDATE OF approved ON pilot_accounts
WHEN OLD.approved=1 AND NEW.approved=0 BEGIN
 UPDATE household_request_notifications SET status='canceled',claim_id='',claim_until=0 WHERE head_sub=NEW.subject AND status IN('queued','sending','uncertain');
END;
