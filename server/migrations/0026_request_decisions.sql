ALTER TABLE household_invitation_requests ADD COLUMN last_decision TEXT NOT NULL DEFAULT '';
CREATE TABLE household_request_decisions (
 actor_sub TEXT NOT NULL, operation_id TEXT NOT NULL, request_id TEXT NOT NULL REFERENCES household_invitation_requests(id),
 household_id TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN('decline','approve')),
 PRIMARY KEY(actor_sub,operation_id)
);
