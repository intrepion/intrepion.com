-- Shared by live maintenance and encrypted recovery. Current restrictions,
-- durable replay receipts and monthly attempt totals are deliberately retained.
DELETE FROM email_send_attempts WHERE attempted_at<=unixepoch()-30*86400;
DELETE FROM email_feedback_receipts WHERE received_at<=unixepoch()-30*86400;
DELETE FROM site_audit WHERE occurred_at<=unixepoch('now','-1 year');
DELETE FROM site_usage_samples WHERE sampled_at<unixepoch()-30*86400;
DELETE FROM onboarding_sessions WHERE expires_at<=unixepoch();
UPDATE email_invitations SET status='revoked',delivery_status='canceled',claim_id='',claim_until=0,revision=revision+1 WHERE status='pending' AND expires_at<=unixepoch();
DELETE FROM email_invitations WHERE status<>'pending' AND expires_at<=unixepoch()-30*86400;
