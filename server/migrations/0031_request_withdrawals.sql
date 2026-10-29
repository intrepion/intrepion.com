CREATE TABLE household_request_withdrawals (
 user_sub TEXT NOT NULL, operation_id TEXT NOT NULL,
 request_id TEXT NOT NULL REFERENCES household_invitation_requests(id),
 PRIMARY KEY(user_sub,operation_id)
);
