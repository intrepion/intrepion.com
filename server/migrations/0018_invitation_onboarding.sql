ALTER TABLE email_invitations ADD COLUMN accepted_by TEXT NOT NULL DEFAULT '';
CREATE TABLE onboarding_sessions(
 token_hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,user_sub TEXT NOT NULL,
 email TEXT NOT NULL,display_name TEXT NOT NULL,
 invitation_id TEXT NOT NULL REFERENCES email_invitations(id) ON DELETE CASCADE,
 generation INTEGER NOT NULL,expires_at INTEGER NOT NULL
);
CREATE INDEX onboarding_expiry ON onboarding_sessions(expires_at);
CREATE TABLE invitation_acceptance_receipts(
 user_sub TEXT NOT NULL,operation_id TEXT NOT NULL,fingerprint TEXT NOT NULL,
 invitation_id TEXT NOT NULL,household_id TEXT NOT NULL,
 PRIMARY KEY(user_sub,operation_id)
);
