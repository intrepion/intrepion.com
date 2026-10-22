# MVP 2 release and recovery

Status: implementation and local verification in progress. Nothing in this document claims a hosted MVP 2 upgrade has occurred. The existing MVP 1 remains live. Maintain the existing $0 target, $10 ceiling, provider caps, Google owner restriction, and manual deployment of a passing exact revision.

## First upgrade

Migration 0005 moves task content into canonical collections and blocks the old task-table writes. This is a maintenance upgrade, not an additive migration safe under the old API. The ordinary Deploy workflow now checks for the completed MVP 2 schema before its migration step; it refuses the first upgrade rather than applying it beneath MVP 1.

Complete implementation checks and review first, then prepare the concrete hosted upgrade for owner launch approval:

1. Verify CI for the exact revision with the existing deployment gate. Create and read back an encrypted pre-upgrade backup. Exercise recovery into an isolated database; never use the live database as a recovery test target.
2. Prepare two separate keys for the existing B2 bucket. The runtime writer must have exactly `writeFiles` and prefix `erasures/<D1 database UUID>/`. The operator recovery reader must have exactly `listFiles` and `readFiles` with the same bucket and prefix. Configure runtime `ERASURE_B2_KEY_ID`, `ERASURE_B2_APPLICATION_KEY`, and `ERASURE_B2_BUCKET_ID` privately. Never reuse the daily-backup writer or place these credentials in the browser or repository. Preserve existing spending caps.
3. Inspect bucket lifecycle rules: rules expiring daily archives must apply only to `daily/`, never to `erasures/` or an empty prefix. Erasure records and all their versions have no automatic expiration. The application writer cannot delete them. Confirm the production key restrictions and an intentional synthetic publication/read/recovery round trip before launch.
4. Stop/suspend the old API and confirm it cannot accept writes. Keep the public client in maintenance/unavailable state. Apply migrations 0003–0006, then start only the reviewed MVP 2 API revision. Do not resume the old binary against this schema. Verify REST batch rollback with synthetic data in an isolated hosted D1 database as well as the local emulator; the local test does not independently prove hosted transport semantics.
5. Check `/auth/config` reports `schema_version: 2` and `erasure_storage_configured: true`. Check the exact live revision, owner login, task migration baseline, shopping persistence, independent runs, pending-erasure retry, and encrypted recovery. Publish the corresponding static client only after these pass. Recheck caps and backup/watchdog status. Future compatible deployments use the existing manual Deploy workflow.

The API fails closed for permanent erasure without ledger configuration. A configuration indicator proves presence, not live provider access. An interrupted publication leaves a content-free intent; reopening that collection exposes the original retry identity so a browser reload does not strand it. Do not clear intents manually to bypass publication.

Rollback requires a compatible MVP 2 revision or an explicit stopped-service recovery decision. Running the MVP 1 binary after migration is not a rollback procedure.

## Recovery after an older backup

Keep the API stopped throughout export selection, ledger retrieval, replay, import, and isolated verification. Do not reopen directly from an old SQL archive: content permanently erased after that archive must first be removed again.

Use a private directory with `umask 077`, a locally available `age` identity, and the reviewed code revision. Supply the recovery reader through private environment variables `B2_KEY_ID`, `B2_APPLICATION_KEY`, and `B2_BUCKET_ID`; do not paste credentials into shell history. Download a fresh complete ledger immediately before replay:

```bash
node scripts/recovery.mjs download-ledger DATABASE_UUID /private/recovery/complete-ledger.json
node scripts/recovery.mjs /private/recovery/database.sql.age /private/recovery/identity.agekey /private/recovery/complete-ledger.json /private/recovery/replayed.sql
node scripts/backups.mjs verify-sql /private/recovery/replayed.sql
```

The downloader follows all version-list pages, verifies names, lengths and checksums, and rejects hidden objects, broad credentials, inconsistent pagination, malformed records, conflicting identities, and wrong database scope. The replay upgrades an MVP 1 snapshot when needed, reconciles the migration ledger, retires erased identifiers, removes erased content/history and content-derived receipts, and clears restored sessions and login challenges. Independent runs keep their copies. A new output file is written only after the complete isolated replay and integrity verification succeeds; existing files are never overwritten.

The generated recovery SQL omits explicit `BEGIN` and `COMMIT` statements because [D1 imports reject those transaction wrappers](https://developers.cloudflare.com/d1/best-practices/import-export-data/). The hosted launch drill caught this incompatibility after local SQLite recovery had passed. The corrected output was imported into an isolated hosted D1 database and checked through the production API, including rejection of a retired identity. The regression suite enforces D1's explicit-transaction restriction at SQLite's statement boundary; the local D1 emulator alone had accepted the incompatible wrapper.

Import `replayed.sql` into a new isolated D1 database. Verify migration records, schema guards, retained content, absence of erased content, retired-identity rejection, and ordinary API workflows before changing the service's database configuration. Provision a new prefix-scoped writer/reader if the D1 database UUID changes: old ledger records remain scoped to the source database. Preserve and replay the source ledger during that recovery, then retain the resulting retired IDs in the new database's future backups. Only after verification may the API reopen. Check backup export/readback and watchdog notifications again. Remove temporary plaintext and identity copies when the drill is complete.

Daily archives keep the existing seven-day policy. The daily pruner only recognizes `daily/YYYY-MM-DD/database.sql.age` and its verification marker; it must never prune ledger objects. History and Trash remain indefinite until explicit erasure. Monitor D1 bytes/rows, backup bytes/age, API latency/errors, and B2 usage against the existing investigation thresholds; no threshold automatically purchases services.

## Local verification

`npm run dev` starts local D1, the native API, the web client and a loopback-only independent ledger. The E2E harness uses temporary database and ledger state. It never uses provider credentials. The standalone approved prototype remains at `npm --prefix prototype run dev` and requires no API.

`npm run test:recovery` requires `age` and `age-keygen` (or `AGE_BIN`/`AGE_KEYGEN_BIN` paths). CI installs age for encryption/recovery integration tests. Browser E2E and coverage remain local-only.
