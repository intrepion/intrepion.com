# MVP 3 release preparation

Status: **local implementation and starter limits approved; production rollout not yet authorized**. Production remains MVP 2. No remote migration, credential change, admission, policy assignment, deployment or workflow activation is recorded by this checklist.

## Ready locally

- Scope, designs, standalone prototype and implementation approved; separate [Standards/Spec review](mvp-3-review.md) completed and findings corrected.
- Local API, browser, encrypted recovery, static checks and production builds passed. Owner-supplied Docker output confirms image construction. See [implementation evidence](mvp-3-implementation.md).
- [Measured sizing](mvp-3-sizing.md), [reproducible calibration](../scripts/calibrate-mvp3.py) and [approved policy values](mvp-3-pilot-policy.json) are available. The existing owner's retained data fits.

## Before the launch decision

Prepare concrete commands/artifacts and results for these gates before requesting final launch approval:

1. **Exact revision and CI.** Select the release SHA and obtain passing full GitHub CI for that exact revision on main. Local checks do not substitute for that gate. Coverage and browser E2E stay local-only. No push or workflow run has been performed as part of numerical approval.
2. **First-upgrade deployment fence.** The ordinary Deploy workflow currently invokes `scripts/mvp2-deploy-preflight.mjs`, which checks MVP 2 anchors only. It must also refuse an unmigrated first MVP 3 upgrade before running migrations. Migration 0012 fences out old content writers; applying 0007–0014 under the active MVP 2 API is not an ordinary compatible deployment. Prepare and verify the updated gate and a stopped-service migration sequence; do not bypass the old gate as a shortcut.
3. **Migration and protected recovery rehearsal.** With private environment-based credentials, read a recent verified encrypted backup and a fresh complete independent erasure ledger. Rehearse current-code recovery and migration through 0014 in an isolated database. Check content/count preservation, actual actor attribution, retired IDs, writer-budget fences, session clearing and all supported ledger versions. Do not use the live database as a restore target or retain plaintext in public logs/artifacts. The sizing-only in-memory upgrade is not this recovery drill.
4. **Private operator/maintenance credentials.** Prepare two distinct random 32-byte secrets encoded as 64 hex characters: `PILOT_OPERATOR_TOKEN` and `HOUSEHOLD_MAINTENANCE_TOKEN`. Stage their server/operations installation privately; never embed them in client builds or this document. Verify the existing database-prefix-scoped erasure writer/reader and backup credentials without broadening their permissions. Existing ledger-key rotation remains due before 2027-01-20.
5. **Policy and monitoring previews.** Prepare the current owner's exact-subject account assignment and structural-policy preview using the approved JSON values. Include the expected revision and measured retained usage; do not apply local demonstration plans. Review the proposed size/row/backlog thresholds and prepare existing-GitHub reporting or an explicitly accepted manual procedure. Daily account-wide D1 analytics remain unavailable to the existing tokens: check the dashboard before admitting any additional account. No new paid plan or monitoring service is required by the proposal.
6. **Maintenance and rollback package.** Prepare the maintenance client, an actual API write-freeze mechanism, fresh backup/readback procedure, exact additive migration commands and compatible-revision recovery plan. A maintenance web page alone does not stop old tabs or direct API calls. Confirm the freeze in the rehearsal. Keep the old API stopped once budget-writer fences are installed; resuming an MVP 2 binary against the new schema is not a supported rollback.

The final launch approval should identify the exact release revision, planned service interruption, frozen-backup/recovery evidence, credential/policy previews, monitoring arrangement and rollback procedure. Numerical approval alone does not approve that action set.

## During the separately approved rollout

1. Publish maintenance state, stop writes at the API and verify the freeze; take/read back the final encrypted backup after the write boundary.
2. Apply only the reviewed migrations 0007–0014. Verify migration records, integrity, preserved content and writer fences. Start only the reviewed MVP 3 API with the private operator/maintenance settings.
3. Assign the approved owner plan and uniform structural caps through revision-checked operator previews and Apply. Keep ordinary writes unavailable until the policy and matching client are ready; approval of a zero/default migration plan is not a substitute for assignment.
4. Verify exact API revision and `/auth/config` schema version 3, production Google auth, erasure storage, personal persistence, household contributions, invitation binding, shared edits, revocation, conflict/retry behavior and protected erasure. Configuration presence alone is not provider verification.
5. Publish the matching static client. Check a fresh owner Google sign-in and retained real data. Add another approved head only after the daily-usage/admission check, with their separate Google identity; do not expose public signup or dependent/PIN access.
6. Read back a new encrypted backup and verify current-schema protected recovery in isolation. Test maintenance authorization and failure notification before explicitly enabling `HOUSEHOLD_OPERATIONS_ENABLED`. Preserve existing backup scheduling and spending controls.
7. Verify root/www HTTPS and headers, maintenance removal, backup age/size reporting and hourly retention behavior. Record exact revisions, run IDs and any accepted limitations before declaring the hosted release complete.

[Operator policy procedures](mvp-3-operator.md), [retention protocol](mvp-3-retention.md) and [MVP 2 recovery history](mvp-2-release.md) supply the underlying procedures. Do not erase content, remove safety metadata, change provider plans or activate automation to work around an incomplete gate.
