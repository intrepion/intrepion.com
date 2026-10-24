# Backup monitoring review

The code-review skill ran independent Standards and Spec agents. The existing user-supplied fixed baseline remains `d5f2fda2d1a0b5fe0f173011e953eb147117abee`, using `git diff d5f2fda...HEAD`. The newly reviewed monitoring stage is commit `4f80cae` relative to `8628945`; earlier MVP 3 findings are recorded separately in `mvp-3-review.md`.

Spec sources: the owner's selected early-warning policy, `mvp-3-monitoring.md`, `mvp-3-monitoring-policy.json`, sizing/release procedures and existing backup-preservation guarantees. Standards sources included `.github/CONTRIBUTING.md`, the glossary, ADRs, the operations privacy rules and the skill's Fowler smell baseline. No external issue, PR or review comment was posted.

## Standards

No documented-standard violations were found. The monitoring CLI keeps SQL, identities, credentials and provider response bodies out of logs. Workflows preserve narrow credentials and local-only E2E/coverage boundaries.

One heuristic finding: possible Duplicated Code in threshold/budget presentation. Alert decisions used the versioned policy, but messages repeated 5/10/15 MiB and 22 hours, while the table repeated 20 MiB independently of its budget calculation. Numeric labels now derive from the same policy and measured budget. This is a maintainability correction; the selected thresholds and behavior are unchanged.

Standards total: zero hard violations, one addressed heuristic finding.

## Spec

No confirmed findings. The changes match the selected size/age thresholds; verified backups precede size failures, failed estimation preserves valid source archives, legacy/invalid measurements are handled explicitly, and actual protected restores retain the 20 MiB ceiling. Output remains aggregate-only. D1 usage, forecasting and household backlog remain manual, and no application launch or household automation is activated.

Exact-revision CI and normal hosted backup/watchdog/measurement-readback/protected-recovery checks remain activation gates; the review itself is not that evidence.

Spec total: zero confirmed findings.
