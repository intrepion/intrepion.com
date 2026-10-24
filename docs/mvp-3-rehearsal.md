# MVP 3 deployment fence and isolated hosted rehearsal

Status: **passed in isolation; no production rollout**. The final verification timestamps and machine-readable results are in [the evidence JSON](research/mvp-3-hosted-rehearsal.json). Existing production data, API revision, credentials, plans, user admission, DNS, provider plans, spending controls and scheduled workflows were not changed. This preparation has not been pushed or deployed.

## Deployment fence

The former `scripts/mvp2-deploy-preflight.mjs` accepted the live MVP 2 schema, which would allow the ordinary migration step to install writer fences underneath the old API. A read-only invocation reproduced that result before the fix.

The workflow now invokes [`scripts/deploy-preflight.mjs`](../scripts/deploy-preflight.mjs) before any migration. It verifies required table/view/index/trigger anchors, every migration record through 0014, positive initialized structural settings, configured approved-account plans, absence of legacy task rows/leftover transaction guards, and foreign-key integrity. It does not change policy or data. Read/network/provider failures reject deployment without printing SQL, credentials, provider bodies or content.

Observed cases:

| Destination state | Guard result |
| --- | --- |
| Live MVP 2 schema, read only | Blocked with the maintenance-upgrade explanation |
| Restored MVP 2 snapshot before migration | Blocked |
| Migrated through 0014, policy bootstrap not done | Blocked |
| Complete schema and approved policy bootstrap | Passed |
| `budget_collection_history_insert` removed in isolation | Blocked; passed after restoration |
| Migration 0014 record removed in isolation | Blocked; passed after restoration |

A pass permits an ordinary **compatible** deployment; it is not permission to do the first upgrade, proof of current provider credentials/ledger availability, a write-freeze mechanism or a substitute for exact-revision CI. Future breaking upgrades need a corresponding compatibility-floor review.

## Migration path

A verified encrypted backup from 2026-10-23 09:23:59 UTC was downloaded with the existing backup reader, checked against its SHA-256 marker, decrypted privately and integrity-checked. At the final rehearsal it was under 24 hours old. Its plaintext SQL was 22,617 bytes and ciphertext 22,817 bytes. No fresh production export or write freeze was performed for this rehearsal.

The raw MVP 2 SQL was imported into a newly created temporary hosted D1 database in the existing account. Only that owned destination received migrations 0007–0014. The process checked all 14 migration records, foreign-key integrity and exact fingerprints of retained collection/item/section fields and content History before and after migration. Only booleans are published; no content fingerprints, private identities or database identifiers appear in this evidence. Legacy History received its original owner as actor. Imported sessions/challenges were cleared in the isolated destination before client checks.

A local production build of the Rust API connected to this temporary hosted D1 database on a separate port. Ephemeral, distinct operator/maintenance credentials were used only for rehearsal. The approved owner plan and 100-item/20-section structural policy were previewed, applied and read back. No such assignment or credential installation occurred in production.

## Protected recovery path

The narrowly scoped independent ledger reader retrieved a fresh complete list, validating names, scope, versions and checksums. The current real ledger contained **six version-1 records**. `recoverArchive` replayed that ledger, upgraded the snapshot through 0014, cleared sessions/challenges and generated current-format SQL. That SQL was then imported into a second temporary hosted D1 database and checked for integrity, preserved replayed content, absent erased targets and cleared authentication records.

Versions 2 and 3 are not yet present in production. Their closure, terminal-erasure and immutable shared-content snapshot behavior was checked by the **local encrypted recovery regression fixtures**, not misreported as live version-2/3 provider traffic. Nine local backup/recovery regressions passed, including older archives and current-schema protection.

Both hosted paths exercised:

- Real generated ConnectRPC clients against the production Rust build and actual hosted D1.
- Exact approved plan/structural readback, maintenance-token rejection at the operator endpoint, and Google-session rejection at that private endpoint.
- Personal list/task reads, a synthetic task save and an identical retry creating exactly one task.
- Rejection of a retired collection identity with `NotFound` and the permanent-erasure explanation.
- Rejection of an old direct content writer without a write-budget context, with no row added.
- Successful hosted REST batch execution, followed by a deliberate failing invariant inside a batch; its earlier insert was rolled back and no guard rows remained.

Client checks used temporary operator-created sessions in the disposable destinations. They do **not** verify fresh Google sign-in, MFA or a hosted MVP 3 browser deployment. Fresh owner Google authentication remains a rollout check. Rehearsal API processes omitted erasure-writer configuration so they could not append synthetic records to the production erasure ledger.

## Cleanup and remaining gates

Each run used two sequential temporary databases. All temporary databases created during verification were deleted, local production-build API processes stopped, and mode-600 plaintext/import/log files removed. The final run records two creations and two successful removals. No private age identity was copied into the temporary directory. Production API health returned HTTP 200 afterward.

Lint, formatting, TypeScript checks and the release build passed. No production runtime code changed in this step; the deployed behavior change is limited to the future workflow's read-only preflight.

Still pending: exact-release CI, production operator/maintenance credential staging, an actual verified API write freeze and maintenance/cutover package, live policy previews at the frozen boundary, and the final launch decision. Backup-age/size reporting and daily account-usage review remain operational gates; do not admit additional accounts without the agreed daily-usage review. See [the release checklist](mvp-3-release.md).

After launch authorization, obtain a new encrypted backup at the actual frozen write boundary and repeat appropriate integrity, recovery, policy and authentication checks. This rehearsal cannot certify data written after its source snapshot.
