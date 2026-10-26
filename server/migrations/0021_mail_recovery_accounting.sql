ALTER TABLE email_monthly_attempts ADD COLUMN accounting_state TEXT NOT NULL DEFAULT 'measured' CHECK(accounting_state IN('measured','recovery_hold'));
CREATE INDEX email_accounting_review ON email_monthly_attempts(accounting_state);
