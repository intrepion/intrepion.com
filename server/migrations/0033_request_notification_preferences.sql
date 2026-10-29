ALTER TABLE pilot_accounts ADD COLUMN google_verified_email TEXT NOT NULL DEFAULT '';
CREATE TABLE household_request_notification_settings (
 household_id TEXT NOT NULL REFERENCES households(id),
 head_sub TEXT NOT NULL REFERENCES pilot_accounts(subject),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
 confirmed_email TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(household_id,head_sub)
);
