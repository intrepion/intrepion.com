ALTER TABLE email_suppressions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE email_suppressions ADD COLUMN last_event_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_send_attempts ADD COLUMN feedback_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_invitations ADD COLUMN delivery_event_at INTEGER NOT NULL DEFAULT 0;
CREATE TABLE email_feedback_receipts(id TEXT PRIMARY KEY,digest TEXT NOT NULL,claim_id TEXT NOT NULL,invitation_id TEXT NOT NULL DEFAULT '',received_at INTEGER NOT NULL DEFAULT(unixepoch()));
CREATE INDEX email_feedback_retention ON email_feedback_receipts(received_at);
-- Minimal current review watermark; old signed feedback must not undo a later clear.
CREATE TABLE email_suppression_reviews(recipient_hash TEXT PRIMARY KEY,cleared_at INTEGER NOT NULL,revision INTEGER NOT NULL);
