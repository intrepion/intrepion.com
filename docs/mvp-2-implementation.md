# MVP 2 implementation record

Status: MVP 2 is live at https://intrepion.com as revision `a02d8f280aa524f95fe4fb311298840fa2400198`. Local verification, hosted setup, the maintenance migration, production workflow checks, and isolated hosted encrypted recovery passed. Scope, wireframes, mockups, and the standalone prototype are approved. See the [launch record](mvp-2-release.md).

## Agreed verification boundaries

The owner explicitly accepted these boundaries and review baseline after prototype approval:

- Generated ConnectRPC client → native API → real local D1: persistence, history, retries, conflicts, and domain rules.
- Browser → real local API: user workflows, errors, and session recovery. Browser E2E remains local-only.
- Encrypted backup export/restore: retained content and erasure-aware recovery.
- Review against commit `9b026e015da0fdfa3fd65d4db7ed3de6f7b570c0` (MVP 1 baseline), including the accepted specification at `docs/mvp-2-plan.md`.

Tests are added one behavior at a time at these interfaces. Focus an API test with:

```bash
npm run test:integration -- --test-name-pattern='shopping items retain'
```

The runner uses a temporary local D1 database, applies all migrations, and removes that temporary state afterward. It does not touch production D1 or private setup credentials.

## Current implementation

- `ListService` contract in `proto/life/v1/lists.proto`, with a generated TypeScript client and native Rust service.
- Normalized collection, item, section, history, and operation-receipt tables. Parent revisions protect the whole collection, including ordering and bulk operations.
- D1's documented REST batch request is supported by the database adapter and equivalent local Worker bridge. Related writes commit atomically; every write after the revision claim is guarded by the claimed operation and its fingerprint.
- Content-free request/database timing logs remain separate from user-visible history.
- A run copies its source within a guarded transaction and uses fresh, deterministic-per-operation child identities so uncertain retries do not create another copy. Existing runs are independent from subsequent template edits.

Primary documentation: [D1 REST batch request](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/) and [D1 batch transaction semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

## Completed test cycles

- Shopping-list creation, one initial history entry, retry identity, restart durability, and owner-only access: failed before the service existed, then passed against local D1. String-bound numeric comparisons required explicit casts for wildcard/history cursor checks.
- Item creation/editing, quantities, stable manual positions, bulk reset, stale revisions, and replay after newer progress: failed on unsupported actions, then passed.
- Concurrent reuse of an operation ID with differing requests: exposed rejected creates leaving orphan collections. Fingerprint guards now reject these without applying writes; the focused regression passes for both creates and edits.
- Template sections/items and independent runs: failed on unsupported actions, then passed for copied notes, fresh identifiers, unchecked progress, retries, and template/run isolation.
- Finished/archived/trashed states: failed on unsupported actions, then passed for read-only restrictions, explicit reopening, and restoration preserving previous states.
- Section/item ordering, historical names, section removal, and Trash discovery/restoration: failed on unsupported actions, then passed.
- A real legacy-database upgrade fixture: failed before backfill existed, then passed for title/notes/completion/revision preservation, migration baseline, and compatible task RPCs. Legacy task writes are now adapters over canonical collections. Old task-table content is removed after backfill, with legacy writes blocked.
- Duplicate child identity: failed because a rejected insert was acknowledged with phantom history. Inserts now skip only an already present child in the same parent; cross-parent collisions abort the transaction. The focused item-collision regression and full API suite pass.

## Verification and hosted release

- Full local API integration suite: 27 passed. Full local browser suite: 22 passed, including the original task workflows and new list/recovery workflows. The list tests reuse an authenticated session to respect the unchanged production rate limiter.
- Rust: 6 unit tests passed; both production and development Clippy checks passed; release build passed. TypeScript, Astro, ESLint, generated client, formatting, backup/probe checks and 3 real age encryption/recovery tests passed.
- Local coverage was collected for the existing client model only: 83.33% lines/statements, 78.57% branches, 100% functions. This is not whole-application or server coverage. Coverage and browser E2E remain outside CI.
- Production UI independently implements shopping, templates/runs, explicit finishing/reopening, section/item editing and ordering, history, Archive, Trash, erasure, safe retry, draft/session recovery, latest-value comparison, and 320px action layout. No prototype application code is imported.
- Encrypted recovery replays the separately retained ledger before producing usable SQL, clears sessions, validates relationships/guards, and reconciles migrations from MVP 1. B2 provisioning and lifecycle review, isolated hosted REST transaction/recovery checks, and the stopped-service production migration are now complete.
- [Two-axis review](mvp-2-review.md) found one retry/concurrency violation, two maintenance concerns and three specification findings. All were corrected and independently rechecked. Bulk updates, history and run copies use shared, byte-bounded rowsets; a maximum-note Unicode copy passes. The final browser run includes the additional unavailable-state regression and passed.

Hosted verification independently checked the ledger scopes, batch rollback, encrypted recovery into isolated D1, and normal production API behavior after restoration. A real published mobile-browser check verified Google-button rendering and shopping persistence across reload using a temporary operator session; it does not substitute for a new human Google sign-in. Temporary sessions, synthetic content, isolated databases and plaintext were removed. Existing zero-cost/spending controls and the manual exact-revision deployment policy remain in force.

The [erasure design](mvp-2-erasure-design.md) records the pending intent/publication/recovery protocol.
