-- Shared by live maintenance and encrypted recovery. Current restrictions,
-- durable replay receipts and monthly attempt totals are deliberately retained.
DELETE FROM email_send_attempts WHERE attempted_at<=unixepoch()-30*86400;
DELETE FROM email_feedback_receipts WHERE received_at<=unixepoch()-30*86400;
DELETE FROM site_audit WHERE occurred_at<=unixepoch('now','-1 year');
DELETE FROM site_usage_samples WHERE sampled_at<unixepoch()-30*86400;
DELETE FROM onboarding_sessions WHERE expires_at<=unixepoch();
DELETE FROM request_sessions WHERE expires_at<=unixepoch();
DELETE FROM request_lookup_sessions WHERE expires_at<=unixepoch();
UPDATE household_invitation_requests SET status='expired',closed_at=expires_at WHERE status='pending' AND expires_at<=unixepoch();
UPDATE email_invitations SET status='revoked',delivery_status='canceled',claim_id='',claim_until=0,revision=revision+1 WHERE status='pending' AND expires_at<=unixepoch();
DELETE FROM email_attempt_reservations WHERE month<>strftime('%Y-%m','now') OR invitation_id IN(SELECT id FROM email_invitations WHERE status<>'pending' OR expires_at<=unixepoch() OR (consent_until<>0 AND consent_until<=unixepoch()));
DELETE FROM email_invitation_operations WHERE invitation_id IN(SELECT i.id FROM email_invitations i JOIN household_invitation_requests q ON q.id=i.request_id WHERE q.closed_at>0 AND q.closed_at<=unixepoch()-30*86400);
DELETE FROM invitation_acceptance_receipts WHERE invitation_id IN(SELECT i.id FROM email_invitations i JOIN household_invitation_requests q ON q.id=i.request_id WHERE q.closed_at>0 AND q.closed_at<=unixepoch()-30*86400);
DELETE FROM onboarding_sessions WHERE invitation_id IN(SELECT i.id FROM email_invitations i JOIN household_invitation_requests q ON q.id=i.request_id WHERE q.closed_at>0 AND q.closed_at<=unixepoch()-30*86400);
DELETE FROM email_invitations WHERE request_id IN(SELECT id FROM household_invitation_requests WHERE closed_at>0 AND closed_at<=unixepoch()-30*86400);
DELETE FROM household_request_operations WHERE request_id IN(SELECT id FROM household_invitation_requests WHERE closed_at>0 AND closed_at<=unixepoch()-30*86400);
DELETE FROM household_request_decisions WHERE request_id IN(SELECT id FROM household_invitation_requests WHERE closed_at>0 AND closed_at<=unixepoch()-30*86400);
DELETE FROM household_request_withdrawals WHERE request_id IN(SELECT id FROM household_invitation_requests WHERE closed_at>0 AND closed_at<=unixepoch()-30*86400);
DELETE FROM household_invitation_requests WHERE closed_at>0 AND closed_at<=unixepoch()-30*86400;
DELETE FROM email_invitations WHERE status<>'pending' AND expires_at<=unixepoch()-30*86400;
