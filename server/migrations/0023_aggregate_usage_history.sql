-- Anonymous aggregate samples only; no identities or private content.
CREATE TABLE site_usage_samples(
 day TEXT PRIMARY KEY,sampled_at INTEGER NOT NULL,
 normal_enabled INTEGER NOT NULL CHECK(normal_enabled IN(0,1)),
 account_count INTEGER NOT NULL CHECK(account_count>=0),
 household_count INTEGER NOT NULL CHECK(household_count>=0),
 logical_bytes INTEGER NOT NULL CHECK(logical_bytes>=0)
);
CREATE INDEX site_usage_sample_age ON site_usage_samples(sampled_at);
