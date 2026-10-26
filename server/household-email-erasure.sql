DELETE FROM email_feedback_receipts WHERE invitation_id IN(SELECT id FROM email_invitations WHERE household_id=?);
DELETE FROM email_send_attempts WHERE invitation_id IN(SELECT id FROM email_invitations WHERE household_id=?);
DELETE FROM email_invitation_operations WHERE invitation_id IN(SELECT id FROM email_invitations WHERE household_id=?);
DELETE FROM invitation_acceptance_receipts WHERE household_id=?;
DELETE FROM onboarding_sessions WHERE invitation_id IN(SELECT id FROM email_invitations WHERE household_id=?);
DELETE FROM email_invitations WHERE household_id=?;
