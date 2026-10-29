CREATE TRIGGER finalize_request_on_invitation_change AFTER UPDATE OF status ON email_invitations
WHEN NEW.request_id<>'' AND NEW.status IN('accepted','revoked') BEGIN
 UPDATE household_invitation_requests SET status=CASE WHEN NEW.status='accepted' THEN 'accepted' ELSE 'canceled' END,closed_at=unixepoch()
 WHERE id=NEW.request_id AND status='approved';
END;
