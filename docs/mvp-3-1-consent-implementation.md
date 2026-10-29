# Consent invitation implementation checkpoints

The owner approved the scope and prototype. The fixed review baseline is commit `b620709`, which records the approved design; the throwaway prototype is on `prototype/consent-invitations`. Existing unrelated untracked prototypes are not part of this feature.

The approved test boundaries are generated ConnectRPC client through local D1, browser through the real local API, encrypted backup and recovery, and signed provider feedback through the local API. The latter three use local emulators where applicable, and browser end-to-end checks remain local.

Integration points identified before implementation:

- The existing `EmailInvitationService.ChangeInvitation` creates an invitation directly from a supplied email. Replace this initiation with an explicit, verified request and head decision; preserve safe handling of existing invitations during migration.
- `auth/onboarding.rs` currently establishes an onboarding session from an emailed invitation, checking the email address. Requesters need a separate limited Google-verified session without creating an account, and the eventual invitation must bind both the verified Google subject and address.
- `mail.rs` currently claims and counts invitation attempts in an atomic D1 batch against the shared 10,000-attempt monthly ceiling. Approval and notifications must coordinate with that accounting, including concurrent approvals, retries, suppression, and recovery holds.
- Recovery currently revokes pending invitations and pauses growth. The new links, request records, notification settings and queues must be incorporated, including retention cleanup before activating a recovered database.
- Head departure, suspension, household closure, retention and storage accounting already have separate paths. Every new record and transition needs to participate in those paths and in the approved race and privacy rules.

Implement in vertical slices through the agreed boundaries, then perform the fixed-baseline specification and standards reviews.

## Work in progress

Request-link creation and revocation, limited requester sign-in, request submission, head listing, request decisions, identity-bound invitation issuance, requester return and withdrawal, head notification delivery, and web screens are present locally. Direct email initiation is disabled. Focused integration and browser checks exercise the request through simulated email and acceptance, wrong Google identity, withdrawal after approval, notification opt-out, signed feedback, and resend after link expiry. This is not yet releasable: remaining lifecycle and safety cases need work, and the complete browser, integration, recovery and review gates must pass. Do not deploy these migrations or RPCs independently.

Recovery revokes restored request links and removes them when replaying household erasure; the complete encrypted-recovery suite passed. The execution sandbox caused `age` to time out on larger inputs through Node's `spawnSync`; the same synthetic input and recovery tests succeeded outside the sandbox. This is not evidence of a production backup defect. Extend recovery tests as the remaining records are added.

The provisional hidden request safety defaults are 100 active links per household, 100 links per household per day, 500 pending requests per household, 30 requests per identity per day, and 500 notices per head per day. Their respective environment settings are `MAX_REQUEST_LINKS_PER_HOUSEHOLD`, `MAX_REQUEST_LINKS_PER_DAY`, `MAX_PENDING_REQUESTS_PER_HOUSEHOLD`, `MAX_REQUESTS_PER_IDENTITY_DAY`, and `MAX_REQUEST_NOTICES_PER_HEAD_DAY`; each accepts 1–100000. The owner audit shows bounded, non-identifying household safety flags. These defaults still require launch measurement and review before enabling the invitation flow.
