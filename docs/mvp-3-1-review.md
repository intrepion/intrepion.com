# MVP 3.1 final code review

Fixed baseline: `b4b55890b9bc6b7d12f65cd206c662dffaf6701c`, the separately committed approved design. Review command: `git diff b4b5589...HEAD`. Initial implementation: `5f6124b`; principal corrections: `642d03a`; final diagnostic correction: `0d0701f`. Both reviewers confirmed that all findings were resolved at `0d0701f`. Approved specification: `docs/mvp-3-1-plan.md`, with ADR 0006 and `design/mvp-3-1` artifacts. The code-review skill ran independent Standards and Spec agents in parallel, followed by independent reinspection. No public review comments or provider changes were made.

## Standards

Zero documented-standard violations. Two initial heuristic findings:

1. Possible Duplicated Code: `approved_identity` performed the same canonical public identity query/error translation twice for owner sign-in. It now computes the value once and reuses it.
2. Possible Duplicated Code with observed drift: overview and access-change responses constructed account metadata separately, returning different retained-household usage. Both now share the set-based account projection and conversion. The generated-client/D1 regression creates a household and compares the suspension response with overview; it reproduced zero versus one household before the correction and passes afterward.

Reinspection found possible Primitive Obsession/inferred context in the new rejection diagnostic: a copy's destination is carried in the RPC while the selected-space header may still be Personal. The audit now explicitly labels that header as **selected request context**, rather than claiming it is the blocked destination. A cross-space copy regression checks the true resource reason, accurate context wording and generic ordinary feedback. No private request payload is parsed for diagnostic collection.

Standards total: zero hard violations, three addressed heuristic findings, no unresolved findings after reinspection.

## Spec

Two P2 findings:

1. The spec requires that the administrator receive the detailed blocking reason. Generic ordinary-client feedback previously discarded that information. Owner-only Site audit now retains a fixed resource/structural reason code, public actor identity, selected request context and time. Only the latest diagnostic per account is retained, bounding row growth; it excludes private content, request payloads and unrecognized error text. Normal clients still receive the agreed general unsaved-change message. RPC regressions cover space and structural caps, owner-only access, no private canaries and bounded replacement. Copy preflight retains a detailed internal cause until its public response is sanitized. Reinspection's misleading context label is corrected as described above.
2. The spec requires bounded automatic retries and durable visible delivery state. A stopped process after claiming its third attempt left `sending` permanently. Queue processing now reconciles expired exhausted claims to failed without another handoff or lowering attempt accounting. The HTTP/API regression holds a local provider response, stops the real server during attempt three, restarts after claim expiry and verifies failed status, zero new sends and exactly three handoffs. Earlier signed feedback remains authoritative.

Spec total: two corrected P2 findings and one corrected diagnostic-label follow-up; no confirmed scope creep or unresolved findings after reinspection.

## Verification and limits

All 62 RPC integration cases pass after the principal corrections. That run upgrades from MVP 1 through migration 0024, exports actual local D1, encrypts it and restores it with 58 independent protection records. The restored synthetic SQL measured 9,342,808 bytes; identity/access state and the retained original task canary survive. The final wording/copy regression passes separately.

The 32 legacy and three normal-account browser cases pass locally; normal-account cases were repeated after the principal review corrections. All 22 backup/recovery/probe checks, six Rust unit tests, two client model tests, Rust production/development Clippy and native release build, generation reproducibility, ESLint, Prettier, TypeScript and Astro checks pass. Browser E2E and coverage remain local-only. Local model coverage is 83.33% statements/lines, 78.57% branches and 100% functions; whole-application coverage is not claimed. Root/web production npm audits report zero vulnerabilities.

The owner reports completing the requested Docker build in their terminal. Agent-side Docker socket access and image inspection remain unavailable because sudo requires the owner's password; no captured build output or image digest is asserted by this review.

Implementation review does not authorize launch. AWS resources, sender/support mailbox readiness, DNS, credentials, real email, measured production safety thresholds and deployment remain separate gates in `docs/mvp-3-1-release.md`. The new scheduled email workflow remains disabled by default. The standalone prototype remains on its separate branch and is excluded from production commits.
