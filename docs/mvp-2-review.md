# MVP 2 implementation review

Baseline: `9b026e015da0fdfa3fd65d4db7ed3de6f7b570c0`. Initial implementation: `577134d`. The owner agreed both the baseline and the public test boundaries before implementation. The code-review skill's two independent reviewers examined standards and specification coverage separately. The specification source is `docs/mvp-2-plan.md`; no issue tracker was introduced into this invitation-only repository.

## Standards

Initial findings:

1. **Documented retry/conflict violation:** the initial collection revision claim did not exclude an already acknowledged action with a different fingerprint. Concurrent reuse of one action UUID across different collections could reject one request after incrementing its collection revision. This contradicted the safe retry/conflict contract in `server/README.md`.
2. **Duplicated eligibility logic (judgment call):** creation, ordinary mutation and run copying reconstructed the same operation-identity predicate and positional bindings separately. The missing claim condition demonstrated the maintenance risk.
3. **Per-child bulk statements (judgment call):** a reset/reorder generated one update and one history insert per affected child. A passing 55-item local test did not establish bounded growth or prove hosted limits.

Resolution: the cross-collection race regression failed with a rejected collection revision of 2 instead of 1, then passed after the initial claim gained the receipt exclusion. The shared `NO_CONFLICTING_RECEIPT` predicate and `operation_identity` bindings now serve the corresponding transaction conditions. Item updates, section positions, history and run copies use set-based JSON rowsets, chunked at 1 MiB of encoded data. Shared history writing removes the relevant duplication. Content-free batch logs include statement count. Existing bulk/retry/history cases and the large Unicode copy case pass.

Reviewer follow-up: all findings resolved; no remaining concrete issues found in the corrections. The reviewer performed a read-only check and did not rerun suites.

## Spec

Initial findings:

1. **Q34 comparison was partial:** “Preserve unsaved drafts for comparison and allow reloading before retrying.” Review latest showed only title and notes, concealing a newer shopping quantity or section while retaining the older draft values.
2. **Q26/Q39 read-only controls were wrong:** archived content allows viewing/history/unarchive/Trash; trashed content is read-only except restoration/erasure. Archived and trashed runs still offered enabled Finish/Reopen controls, although the API rejected them.
3. **Pending-erasure pause was partial:** the erasure design says other changes remain blocked. Several collection actions, Start run, completion and individual-erasure controls stayed enabled and necessarily produced rejected changes.

No material scope creep was found. Household access, AI, offline operation, themes, conversions and additional clients remain deferred. Core ordering, independent copies, migration baselines, history redaction and erasure replay appeared aligned.

Resolution: comparison now shows saved quantity, section, progress and Trash state alongside the unchanged draft. A missing section requires an explicit destination choice. Run and collection controls consistently respect archived, trashed, pending and uncertain states. A reloaded client can retry the original pending erasure. Browser regressions reproduce the original failures and pass after correction; disabled-state checks wait for server acknowledgement rather than accepting temporary busy disabling.

Reviewer follow-up: all three findings resolved; no unresolved concrete issues found in the corrections. The reviewer did not run suites.

## Verification and release boundary

Final local verification: 27 API integration tests, 22 browser tests, 6 Rust unit tests, 3 real encryption/recovery tests, and backup/probe/web unit checks passed. Production and development Clippy, lint, type checks, formatting, generated-client verification and the Rust release build passed. Coverage remains local and limited to the existing client model; see the implementation record. An additional failure-state regression caught a misleading empty-state message after a failed list request; unavailable and confirmed-empty states are now separate, with a successful retry verified.

Hosted B2 scope/lifecycle checks, isolated hosted D1 transaction/recovery proof and the stopped-service migration remain release requirements. Local emulators do not prove those provider behaviors. See `mvp-2-release.md`; the live MVP 1 was not changed by this implementation work.

Initial totals: Standards—1 hard violation and 2 maintenance judgments; Spec—3 behavior findings. The worst Standards issue was the rejected edit changing concurrency state; the worst Spec issue was incomplete conflict comparison. Both axes' findings were corrected and independently rechecked.
