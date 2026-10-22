# Erasure and recovery implementation design

Status: the accepted Q17/Q25/Q37 behavior is implemented and passes local RPC/browser/encrypted-recovery tests; hosted provisioning and recovery verification remain required. This does not authorize a hosted deployment or new spending.

The ledger must survive restoring an older D1 backup. An in-database deletion table alone cannot satisfy Q37. Use the existing B2 backup bucket with a separately scoped append-only application key restricted to the exact `erasures/<D1 database UUID>/` prefix. Ledger records contain the database identifier, operation identifier, collection identifier, optional item identifier, and erasure scope, never names, notes, quantities, Google credentials, or content snapshots. Owner-account transfer must not invalidate recovery: scope ledger records to the database and stable entity IDs, not the current Google identity. Enforce global collection/item identifiers within the database before relying on this replay rule.

## Failure-safe publication

1. Atomically claim an erasure intent in D1 only if the acknowledged parent revision and required Trash state still match. The content-free intent locks that collection against other mutations. It identifies the confirmed action and target; it contains no content.
2. Publish the intent to the independent ledger. A failed or uncertain upload leaves the intent pending, and the client retries the same action. Other changes remain blocked with an explanatory error. No successful erasure is acknowledged yet.
3. After publication, atomically retire identifiers, remove content and associated history, remove content-derived operation fingerprints for the collection, insert a content-free erasure receipt, update the parent revision for item erasure, and remove the intent. A lost acknowledgement can return the erasure receipt on retry.

Claiming the intent before publication prevents a stale rejected action from appearing in the independent ledger and later deleting content during recovery. Holding the intent lock prevents an intervening edit between ledger publication and erasure. Repeated publication may create identical B2 object versions; record identity and replay must be idempotent.

An item erasure removes only that item's history entries from its parent. Collection history deliberately stores targeted value changes, not whole-collection content snapshots, so other entries do not hide copies of the erased item. Erasing a collection removes all children and history. Existing checklist runs retain their independent copies. Retired identifiers prevent delayed creates from resurrecting content.

## Local development and tests

Implement a loopback-only ledger emulator with filesystem records stored separately from the local D1 database state. The regular one-command local development and E2E harnesses start it automatically. API integration tests use temporary ledger storage and provider-failure controls, never real B2 credentials. Test pending publication, restart/retry, blocked conflicting mutations, acknowledged erasure, receipt replay, identifier retirement, and history redaction through the agreed RPC boundary.

The recovery seam must exercise export/encryption/restore plus replay of the independent content-free ledger before the restored application is available. Verify that erasures newer than the backup are reapplied, independent run copies survive, and malformed/wrong-database ledger records fail closed.

## Production configuration and recovery

- Use a separate B2 key scoped to the existing bucket and ledger prefix with only the upload permissions needed. Do not reuse unrestricted operator credentials or expose keys to the browser.
- Preserve existing provider spending controls. Ledger objects must not be included in seven-day daily-backup pruning; records do not automatically expire.
- Missing production ledger configuration must disable permanent erasure safely. Do not deploy a supposedly complete MVP 2 until the configured ledger and recovery procedure have been validated.
- Recovery downloads all relevant ledger records/versions using read-only operator access, validates database scope and identifier formats, and reapplies erasures before service resumes. Old SQL backups still expire under existing retention. No public application restore endpoint is needed.
- The API should expose a content-free readiness/configuration indicator; never print provider response bodies or credential values in logs.

Primary references: [B2 upload URL requires writeFiles](https://www.backblaze.com/apidocs/b2-get-upload-url), [B2 upload protocol](https://www.backblaze.com/apidocs/b2-upload-file), and [application-key prefix restrictions](https://www.backblaze.com/docs/en/cloud-storage-get-started-with-a-backblaze-integration).

See the [release and recovery procedure](mvp-2-release.md) for exact operator commands, scope checks, schema upgrade, and hosted verification still required before launch.
