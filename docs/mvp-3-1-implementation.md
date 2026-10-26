# MVP 3.1 implementation record

Status: scope, wireframes, visual mockups and the standalone prototype are approved. Production implementation is in progress. No MVP 3.1 provider resources, credentials, DNS, real email or deployment have been changed.

Specification: [approved MVP 3.1 scope](mvp-3-1-plan.md). At the owner’s request, approved design was committed separately as `b4b5589`; that commit is the fixed review baseline. Production changes are excluded from it. This is not a claim that final review has occurred.

## Agreed test boundaries

Reuse the user-approved seams: generated ConnectRPC client through real local D1 for persistence, History, permissions, retries and conflicts; browser through the real local API for workflows and session recovery (local only); encrypted backup export/restore for retention, erasure and later security revocations. Each production slice starts with a failing behavioral regression at one of these boundaries. No internal-helper seam is introduced.

The owner also approved signed provider HTTP notifications through the real local API/D1, using local mail and certificate emulators. This additional boundary covers forged/replayed callbacks and suppression without contacting AWS.

## Implementation sequence

1. Owner-only metadata administration, preserving private content boundaries.
2. Explicit reviewed safety-policy activation/migration: independent personal/household budgets, no reserved contributions or member ceilings, compatible existing content/history and generic rejected-save feedback.
3. Recipient-only email invitations and pre-account Google onboarding with atomic, retry-safe acceptance; issuer departure/revocation/expiry/pause checks.
4. Durable bounded SES sending, global attempt accounting, authenticated delivery feedback and suppression, and operations scheduling.
5. Owner policy/pause/suspend/restore controls with confirmations, audit retention and independent security protection.
6. Production web flows, independent of prototype code, including server-free draft/session recovery and hidden ordinary-user capacity controls.
7. Recovery/backup schema and security replay, actual retained-data sizing, provider setup plans, full checks and two-axis review.

Numeric launch safety thresholds, actual sender/support mailboxes, AWS production access/credentials and live rollout remain their later explicit gates. Do not assign prototype numbers or silently activate onboarding during migration. Preserve existing spending and recovery limits.

## Verified production slices

- Generated AccountAdminService client → real local D1: owner-only account/household usage metadata, explicit unknown provider usage, no private content; anonymous/ordinary authenticated access rejected.
- Reviewed independent safety policy: preview-bound, revision-checked, confirmed activation; legacy contribution records retained, member ceilings retired, name-only household creation and shared task writes.
- Concurrent final-slot writes: exactly one task persisted, the losing transaction rolled back, and ordinary clients received general non-numerical unsaved-change feedback.
- Emailed invitation records: head-only metadata, stable retry receipts, server-only HMAC-derived acceptance secrets (hashes only in D1), explicit replacement/revocation, owner growth pause/resume.

- Durable local email delivery: private operations authentication, recipient-only links, persisted attempt accounting and generic head-visible delivery metadata.
- Recipient-bound onboarding: matching Google proof prepares an isolated short-lived session; explicit acceptance creates account/membership atomically, preserves existing names, supports retry receipts and respects growth pause, replacement and logout.
- Account suspension/restoration: ends old sessions, preserves content/membership and publishes pseudonymous independently retained security markers before acknowledging changes.
- Encrypted restore regression: later account suspensions and head removals survive recovery; pending links and authentication sessions are invalidated, and growth remains paused.
- Local browser workflows: name-only household creation, emailed recipient onboarding with editable new-user display name, shared tasks, private personal tasks surviving reload, and owner-only Admin navigation. Both normal-account browser regressions passed.
- Signed provider callback: plaintext SNS payloads are authenticated against the configured topic/certificate endpoint before processing. Forged signatures, wrong topics and arbitrary certificate URLs are rejected; duplicate permanent-bounce feedback is applied once and suppresses subsequent sending. Both safety-policy and signed-feedback regressions passed together.
- Confirmed suppression review: ordinary accounts, unconfirmed requests and stale revisions cannot clear a block. Owner retries are idempotent; old feedback with a fresh envelope ID cannot undo the reviewed clear. The local callback/RPC regression passed.
- Membership revisions: acceptance advances the household revision exactly once, including repeated acceptance acknowledgments. The generated-client regression reproduced the missing increment and now passes.
- Owner browser controls: cancellation, confirmed growth pause/resume, persistence after reload and preview-bound safety-threshold changes passed locally.
- Recovery ordering: an older independently published restoration cannot undo a newer suspension present in the snapshot's unpublished security outbox. The encrypted regression reproduced this rollback bug and now passes; matching journal records acknowledge pending entries while conflicting revisions fail closed.
- Expanded owner browser review: usage flags, email attempt visibility, no self-suspension control, and confirmed account suspension/restoration passed in both normal-account workflows.
- Independent copies: the generated-client regression reproduced legacy zero head ceilings rejecting normal-account copies. Preflight and saving now use independent household budgets, omit ordinary-user numeric capacity fields and preserve the original privately; the regression passes.
- Retention: shared live-maintenance/recovery SQL removes mail attempts and callback receipts after 30 days, admin audit after one year, expired onboarding sessions and old invitations. Current restrictions, replay receipts and monthly attempt aggregates remain. Encrypted recovery verified expired logs disappear without resetting the retained block or send counter. Live cleanup is throttled to hourly and runs from the mail worker/private queue and authenticated household maintenance.
- Lost acceptance response: the still-valid, recipient-bound onboarding session can recover the already accepted account's normal session cookie without admitting another account or membership. The generated-client regression passes.
- Unavailable invitations: unknown/replaced links return a generic unavailable response separately from the valid-link/wrong-Google case, without disclosing household details.
- Bounded owner overview: metadata is paged, whole-site counts/storage totals stay complete, and usage is fetched with set-based queries rather than a separate query per account/household. The RPC regression and support-link browser workflow pass.
- Household erasure removes its invitation records, delivery attempts, callback receipts and invitation/acceptance receipts using the same policy in live maintenance and recovery. Current email suppression remains independent. All six encrypted-recovery regressions pass.
- Conservative recovery mail accounting: a restored snapshot may omit later sends, so recovery holds the current UTC month's counter at least at the existing 10,000-attempt ceiling and labels it `recovery_hold`. This is a conservative floor, not a measurement of actual sends. Growth pause and the email hold are independent; ordinary account/list use remains available. A new UTC month starts its own allowance. The size estimator includes the hold, and all six recovery regressions pass with migration 0021.

These are partial implementation results, not final MVP 3.1 acceptance. The full local validation below is complete; the independent final review and Docker verification are still pending.

## Current slice

Production implementation is ready for fixed-baseline two-axis review. Keep growth paused by default and real outbound sending unconfigured until the provider/setup gates. The Docker build still requires the owner’s terminal because Docker socket access is denied and sudo requires a password.

## Prototype record

The owner approved the nine-walkthrough [standalone prototype](../design/mvp-3-1/PROTOTYPE.md). Its disposable HTML/model will not be promoted into production. The approved primary source is captured on `prototype/mvp-3-1-invitations` at `6c403502bd1f23da837155a34fcbce87347e97bb`; only validated decisions belong in production.

## Local verification before final review

- All 61 generated-client/local-D1 integration cases pass, including signed subscription confirmation, forged/replayed feedback, uncertain-send retry with the same private link, and callback-before-send-acknowledgment suppression.
- The same run upgrades from MVP 1 through migration 0024, exports actual local D1, encrypts with age, restores with 56 independent protection records, and verifies current public identities/access and the original task canary. The synthetic restored export measured 9,334,123 bytes; this is a test workload, not a measurement of live data or production headroom.
- All 32 legacy browser cases and all three normal-account browser cases pass locally. Empty/malformed invitation fragments are removed and offer a recovery screen. Prototype code remains separate.
- All 22 backup/recovery/probe checks pass. Recovery preserves later access restrictions, rejects conflicting protected identities and applies the conservative current-month mail hold.
- Rust formatting, production/development Clippy, six Rust unit tests and release build pass. Generated TypeScript, ESLint, Prettier, TypeScript and Astro checks pass; Astro reports zero errors/warnings/hints. Two client model tests pass. Local model coverage: 83.33% statements/lines, 78.57% branches, 100% functions; this does not measure whole-application coverage.
- Root and web production npm audits report zero vulnerabilities. Native production build succeeds. Docker verification is pending owner execution, not claimed as passed.
- `npm run dev:normal` starts isolated persistent local D1 and the fake mailbox successfully. No provider resources, DNS, credentials, real messages or production deployment were changed.

Initial policy activation now independently preserves existing account/head states before acknowledgment. All subsequent account admissions use the same protection journal. Retained household slots and metadata/history/invitation payload storage are accounted for, while ordinary capacity figures remain hidden. Owner audit and recovery review, paginated usage/growth metadata and confirmed suppression review are implemented.
