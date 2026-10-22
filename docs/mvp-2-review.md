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

## Hosted recovery correction

The launch drill found that hosted D1 rejects explicit transaction wrappers in generated recovery SQL. The local D1 emulator accepted that same import, so it did not expose the incompatibility. Correction `4a082ac` removes only the exported transaction wrapper; replay and integrity checking still complete in an isolated local transaction before any output is produced. A regression enforces the hosted restriction using SQLite's statement authorizer. It failed before the correction and passed afterward, while allowing SQL-looking text to remain ordinary data.

### Standards follow-up

The independent reviewer found no documented-standard violations or actionable smells. The correction preserves isolated import and verification. The regression exercises the agreed encrypted-recovery boundary without matching against user text. Findings: **0**; worst issue: **none**.

### Spec follow-up

The independent reviewer found no missing requirements, incorrect behavior or scope creep. Q37 replay and integrity guarantees remain intact; isolated import and verification are still required before reopening the application. Findings: **0**; worst issue: **none**.

All three encryption/recovery tests and lint passed. The corrected SQL also imported into a new isolated hosted D1 database. The normal production API read and created synthetic data against that restored database and rejected reuse of an erased identity. Restored sessions were cleared; integrity and all six migrations were checked. The temporary database and plaintext files were removed. These are completed hosted recovery checks, not a claim that final public-client deployment has finished.

## CI fallback review and launch

The independent Standards review of `a02d8f2` found no correctness, security or actionable smell findings. It identified one outdated runbook sentence requiring push-only CI; that sentence now matches the gate. The independent Spec review found zero findings: push/PR triggers remain, manual dispatch executes the identical full suite, and the exact SHA, `main` branch, accepted event and latest-success requirements remain enforced. Coverage and browser E2E stay local-only. Remaining findings: Standards **0**, worst **none**; Spec **0**, worst **none**.

The final full CI and Deploy workflows passed for `a02d8f280aa524f95fe4fb311298840fa2400198`. Hosted recovery and published-site browser checks also passed; see the release record for evidence and the distinction between operator-session checks and a fresh human Google sign-in.
