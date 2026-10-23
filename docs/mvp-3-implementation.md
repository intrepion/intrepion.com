# MVP 3 implementation record

Status: in progress. Scope, wireframes, mockups and the standalone prototype are approved. Numerical launch limits and deployment are separate gates. Review baseline: `d5f2fda` (requested by the owner). The owner requested a commit of current local work as the review baseline; that commit includes the first account-isolation slice as well as the approved planning/design artifacts. Review the final behavior against the complete scope, including that baseline slice.

## Test boundaries

Reuse the user-approved boundaries: generated ConnectRPC client through the real local D1 adapter for persistence, History, permissions, retries and conflicts; browser through the real local API for workflows/session recovery, run locally only; encrypted backup export/restore for retention and erasures. No new internal-helper seams are introduced. Each production slice starts with a failing behavioral regression and implements that slice before adding another.

## Completed slices

- Added operator-approved Google subject records. Existing data owners are preserved during migration; the configured original owner remains the bootstrap identity. Other accounts require explicit admission.
- Sessions resolve their own identity against the approved account registry on each request. Revoking approval ends subsequent session access. Google signature, nonce, issuer, audience and expiry checks remain required before registry admission is consulted.
- Task and list requests resolve a personal data scope from the authenticated session instead of always using the configured owner. Development identity selection remains feature-gated and still requires an approved registry entry.
- Red: two different development identities could read each other's personal tasks under the old single-owner implementation. Green: the same generated-client/local-D1 regression confirms isolated task listings and cross-account collection reads return NotFound.

- Household creation now reserves resources transactionally, retains personal privacy and acknowledges retries without reserving twice. Its generated-client/local-D1 regression passes.
- Recipient-bound invitations, acceptance, shared scope selection, actual History authors and live-session membership revocation pass the generated-client/local-D1 regression.
- Own ceilings and transactional retained-content quotas pass a concurrent-write regression: only one of two creates can take the final slot; Trash retains it; protected permanent erasure releases it. Named transaction constraints return specific quota explanations.

## Full-storage recovery amendment

The owner approved explicitly confirmed erasure of selected active content when full storage prevents creating Trash History. The wireframe, mockup and standalone prototype were amended before implementing the production recovery flow. Preserve target/scope confirmation, independent-copy behavior and erasure-ledger protection; never silently discard History or content to fit a quota.

- The generated-client/local-D1 recovery regression passes: full storage blocks Trash History, active erasure requires explicit confirmation, and an uncertain ledger acknowledgment preserves content and reserved capacity until retry succeeds.
- Separate private accounts can reuse a client action UUID without colliding in the independent erasure ledger. Publication identities are namespaced by database, data scope and target; client retry identities remain unchanged.
- Household names count toward retained UTF-8 bytes. A zero-storage creation is rejected without reserving capacity; a seven-byte Unicode name fits an exact seven-byte allocation. Copy and erasure accounting regressions pass with retained name bytes included.
- Administrative History and invitation listings are restricted to current heads and omit invitation tokens. A concurrent invitation retry regression caught and fixed an acknowledgment that returned an unsaved invitation ID; replies now use the durable receipt.

- Last-head closure records its exact UTC month boundary in a content-free transactional outbox. Access ends immediately; acknowledgment waits for independent recovery protection. A lost provider acknowledgment is retryable through the departing user's owned receipt.
- Operator-only maintenance protects pending closures and erases due closed households. It publishes the independent household-erasure marker before deleting shared content/History/metadata and releasing allocations. Failure keeps capacity reserved and marks erasure delayed; the generated-client/local-D1 time-travel regression passes.
- Encrypted recovery understands migrations through `0014`, reapplies closure and terminal erasure markers regardless of provider listing order, prevents closed ID reuse even before household creation, preserves independent personal copies, and refuses archives missing household protection. Backup validation includes lifecycle relationships and empty transaction guards.
- The hourly GitHub retention workflow is gated by a separate, unset `HOUSEHOLD_OPERATIONS_ENABLED` variable. It requires a separate server/operations secret and is not activated by this local implementation.

- Database insert/update triggers require the transaction's matching write budget, preventing older writers from adding content or History without quota enforcement. The current quota/invitation/maintenance regressions pass with this fence; the complete encrypted recovery suite (including MVP 1 upgrades and version-1 erasure replay) passes.
- Local development and E2E seed finite illustrative plans and two approved development identities without assigning production values or replacing configured local policy.

- The first production browser slice passes through the real local API: create a household with explicit allocations, switch between private/shared tasks, preserve both across reload, and render without horizontal overflow at 390 px. Production controllers are independent of prototype code.

- A two-browser regression passes recipient-bound invitation delivery and acceptance, fragment removal in an already-open tab, head removal, and clearing a revoked household draft on the next request while preserving the person's Google session. API responses from an obsolete identity/space context cannot restore stale content.

- Production allocation controls pass a real-browser regression: preview exact reserved/remainder changes, explicitly confirm, persist the caller's allocation, and explain a blocked withdrawal without changing it.
- The approved full-storage browser flow passes: failed Trash History offers selected active-content recovery, the confirmation names the task and space, Cancel retains it, lost ledger acknowledgment retains data, and a browser reload resumes the saved confirmed-erasure identity. Other shared content survives. Task compatibility responses expose pending erasure without exposing its token/fingerprint; the collection API supplies the complete retry request.

## Final validation pending

- Run complete browser workflows together, required full checks, local-only coverage/E2E and production visual review.
- Review both standards and the complete approved scope against `d5f2fda`, fix findings and commit the completed implementation. No production deployment is included.

D1's documented [batch transaction rollback](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) is relevant to concurrent membership/quota enforcement. The implementation must verify the behavior through local D1, including rollback when a final invariant check fails; a successful preflight alone is insufficient.

## Launch gates retained

Calibrate finite plan/structural caps against existing content and representative whole-database SQL-export overhead. Preserve provider spending controls and the 20 MiB export ceiling. Do not assign illustrative prototype limits to production or enable payments. Confirm launch separately after code and recovery verification.

## Further verified production slices

- Own count-ceiling controls preserve household capacity and saved data; a quota-rejected task keeps its draft until explicit discard. The real-browser regression passes.
- Independent-copy controls preview a destination, require scope confirmation, create fresh shared History and retain the original private list and quantities. The real-browser regression passes.
- Last-head closure displays the precise UTC/local cutoff, handles Cancel and final departure, and shows retained contributions privately. Lost recovery acknowledgment clears shared access, displays protection pending and allows the same owned action to finish protection.
- Whole-shared-content erasure uses an immutable identifier-only manifest. New writes pause while protection is pending; protected completion removes the selected snapshot and keeps the household and reserved contributions. Retrying never includes later content. API and browser regressions, including resume after reload, pass.
- Version-3 ledger records hold bounded chunks of selected collection UUIDs. Encrypted recovery preserves later non-target content and independent private copies, rejects targets outside the named household, and remains compatible with version-1/2 records and MVP 1 archives. The recovery suite passes after this extension.

- Operator admission and plan assignment use a separate private credential and preview-bound, revision-checked transactions. Explicit replacement allocations show own cuts and aggregate household effects, preserve over-quota data and reject changed retained usage. Structural changes preserve oversized collections and block further growth. Generated-client/local-D1 regressions pass.
- Approval revocation deletes existing sessions. Reapproval permits a fresh login without reviving old sessions. The regression passes.
- The operator CLI writes a private origin-bound review file before Apply, retains stable action identities for retries and includes no web dashboard. Operator-assisted global-erasure and retained-attribution procedures are documented separately from access revocation.
- Administrative History shows actual actors and before/after own-ceiling/allocation values; the browser regression passes.
