CREATE TABLE household_request_links (
 id TEXT PRIMARY KEY,
 household_id TEXT NOT NULL REFERENCES households(id),
 created_by TEXT NOT NULL REFERENCES pilot_accounts(subject),
 token_hash TEXT NOT NULL UNIQUE,
 expires_at INTEGER NOT NULL,
 revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN(0,1)),
 created_at INTEGER NOT NULL DEFAULT(unixepoch())
);
CREATE INDEX household_request_links_household ON household_request_links(household_id, created_at);
CREATE TABLE request_sessions (
 token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, user_sub TEXT NOT NULL,
 email TEXT NOT NULL, display_name TEXT NOT NULL,
 link_id TEXT NOT NULL REFERENCES household_request_links(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
CREATE TABLE household_invitation_requests (
 id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id),
 link_id TEXT NOT NULL REFERENCES household_request_links(id),
 user_sub TEXT NOT NULL, email TEXT NOT NULL, display_name TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('pending','canceled','expired','approved','declined','withdrawn','accepted')),
 consent_version TEXT NOT NULL, requested_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 closed_at INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX one_pending_request_per_identity ON household_invitation_requests(household_id,user_sub) WHERE status='pending';
CREATE TABLE household_request_operations (
 user_sub TEXT NOT NULL, operation_id TEXT NOT NULL, link_id TEXT NOT NULL,
 request_id TEXT NOT NULL REFERENCES household_invitation_requests(id),
 PRIMARY KEY(user_sub,operation_id)
);
