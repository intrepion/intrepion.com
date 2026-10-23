# MVP 3 implementation record

Status: in progress. Scope, wireframes, mockups and the standalone prototype are approved. Numerical launch limits and deployment are separate gates. The owner requested a commit of current local work as the review baseline; that commit includes the first account-isolation slice as well as the approved planning/design artifacts. Review the final behavior against the complete scope, including that baseline slice.

## Test boundaries

Reuse the user-approved boundaries: generated ConnectRPC client through the real local D1 adapter for persistence, History, permissions, retries and conflicts; browser through the real local API for workflows/session recovery, run locally only; encrypted backup export/restore for retention and erasures. No new internal-helper seams are introduced. Each production slice starts with a failing behavioral regression and implements that slice before adding another.

## Completed slice

- Added operator-approved Google subject records. Existing data owners are preserved during migration; the configured original owner remains the bootstrap identity. Other accounts require explicit admission.
- Sessions resolve their own identity against the approved account registry on each request. Revoking approval ends subsequent session access. Google signature, nonce, issuer, audience and expiry checks remain required before registry admission is consulted.
- Task and list requests resolve a personal data scope from the authenticated session instead of always using the configured owner. Development identity selection remains feature-gated and still requires an approved registry entry.
- Red: two different development identities could read each other's personal tasks under the old single-owner implementation. Green: the same generated-client/local-D1 regression confirms isolated task listings and cross-account collection reads return NotFound.

## Remaining slices

- Household persistence, explicit scope selection, invitations and membership revocation, actual actor/creator attribution and safe personal copying.
- Customer usage, structural caps, per-head ceilings, independent contributions and previewed reallocation, with transactional concurrency checks and operator plan/admission tools.
- Final closure, protected scheduled erasure, retained allocations, retries and encrypted recovery extensions.
- Production web workflows from the approved designs, including privacy, quota explanations, lost drafts, membership changes and deliberate refresh.
- Local browser review, required checks, two-axis review, fixes and a completion commit. No production deployment is included.

D1's documented [batch transaction rollback](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) is relevant to concurrent membership/quota enforcement. The implementation must verify the behavior through local D1, including rollback when a final invariant check fails; a successful preflight alone is insufficient.

## Launch gates retained

Calibrate finite plan/structural caps against existing content and representative whole-database SQL-export overhead. Preserve provider spending controls and the 20 MiB export ceiling. Do not assign illustrative prototype limits to production or enable payments. Confirm launch separately after code and recovery verification.
