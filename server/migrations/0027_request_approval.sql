ALTER TABLE email_invitations ADD COLUMN request_id TEXT NOT NULL DEFAULT '';
ALTER TABLE email_invitations ADD COLUMN recipient_sub TEXT NOT NULL DEFAULT '';
ALTER TABLE email_invitations ADD COLUMN consent_until INTEGER NOT NULL DEFAULT 0;
CREATE TABLE email_attempt_reservations (
 invitation_id TEXT PRIMARY KEY REFERENCES email_invitations(id) ON DELETE CASCADE,
 month TEXT NOT NULL
);
CREATE INDEX email_reservation_month ON email_attempt_reservations(month);
CREATE TRIGGER release_terminal_invitation_reservation AFTER UPDATE OF status ON email_invitations
WHEN NEW.status <> 'pending' BEGIN
 DELETE FROM email_attempt_reservations WHERE invitation_id=NEW.id;
END;
