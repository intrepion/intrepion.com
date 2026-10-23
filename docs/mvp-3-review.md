# MVP 3 final review

Fixed baseline: `d5f2fda2d1a0b5fe0f173011e953eb147117abee`. Reviewed with `git diff d5f2fda...HEAD`; initial implementation commits were `6614c9a` and `4ee6e0b`. The baseline already includes the first account-isolation slice, so the scope review also inspected that behavior. The approved source is `docs/mvp-3-plan.md`, including the active-content recovery amendment, with ADR 0005 and the approved design/prototype artifacts.

The code-review skill ran independent Standards and Spec agents in parallel. Reports and fixes stay in this repository; no public issue, PR or review comment was posted.

## Standards

No documented-standard violations were found. One heuristic finding: possible Duplicated Code in `server/src/capacity.rs`; `account_guard` and `allocation_account_guard` repeated the same correlated retained-resource checks, differing in whether the headed-household cap applies. Extracted `account_resource_checks` preserves that intentional distinction and gives both guards the same accounting expression.

Standards total: zero hard violations, one heuristic finding, addressed by extraction.

## Spec

One P2 finding: operator replacement allocations could withdraw required household backing while keeping the corresponding plan allowance unchanged. The plan requires voluntary moves to leave source spaces within allowance; ADR 0005 permits retained overages for genuine plan reductions. An unrelated resource reduction must not authorize withdrawing required backing in an unchanged dimension.

Resolution: preview now rejects a reduced household dimension below retained usage unless that same plan dimension genuinely decreases. Apply recomputes that preview and retains its transactional usage/revision checks. Existing overages may remain unchanged during unrelated policy edits. The generated-client/local-D1 regression failed before the fix and passes for unchanged plans, increased item allowances and an unrelated byte reduction; genuine item-plan loss remains allowed with explicit replacements. The three affected household/allocation/operator regressions pass. The Spec reviewer inspected the correction and confirmed the finding resolved.

Spec total: one finding, corrected and verified. No other missing requirement or scope creep was confirmed by the review.

## Subsequent browser validation

A complete browser run exposed an additional timing bug: toolbar replacement during a space load created enabled controls even though navigation was still busy, so an early click could be ignored. A deterministic browser regression holds the real task-list request and checks that the new Household control remains disabled. It failed before the correction. Toolbar rendering now asks the parent to synchronize the existing busy state; the Spec reviewer inspected this small follow-up and found no scope or identity regression. The final isolated browser suite passes all 32 tests, including this delayed-response regression; validation details are recorded in the implementation log.

Browser fixtures now wait for server-confirmed completion before dependent actions: the persistence test waits for the edited task before reloading, and the two-browser membership test waits for removal acknowledgment before issuing the former member’s next request. A click alone does not guarantee that a response has arrived. Feature fixtures share validated real pilot sessions across workflows so the expanded suite respects the unchanged production login limiter; explicit logout/expiry steps retain real challenge exchanges.

Review totals: Standards — zero hard violations, one addressed heuristic; Spec — one corrected P2, no unresolved review findings.
