CREATE TABLE request_lookup_sessions (
 token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, user_sub TEXT NOT NULL,
 email TEXT NOT NULL, display_name TEXT NOT NULL, expires_at INTEGER NOT NULL
);
