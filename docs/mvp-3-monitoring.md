# MVP 3 monitoring and operating procedure

The owner selected the early-warning policy on 2026-10-24. The versioned [policy](mvp-3-monitoring-policy.json) covers SQL size and backup age using the existing GitHub operations workflows and notification settings. It adds no service, paid plan, provider permissions or application quota changes. Production application deployment remains a separate decision.

## Automated size and age checks

The existing backup workflow now runs **twice daily, at 04:17 and 16:17 UTC**, using `scripts/backup-operations.mjs create EXPORT.sql`. The owner selected this cadence so the normal 12-hour interval fits below the 22-hour age alert; pairing a once-daily backup with that alert would routinely fail before the next backup was due. This adds one scheduled export per day. D1 exports can temporarily block other database requests. Seven-day all-version retention remains unchanged: normally fourteen scheduled archives plus markers, with additional versions from manual runs/retries. No paid plan is added.

The command validates the plaintext export and measures the current recovery serializer after upgrading an isolated in-memory copy through migration 0014. It then encrypts, uploads and reads back the archive and its verification marker using the existing narrowly scoped writer. Successful marker readback precedes the existing seven-day pruning procedure. Size alerts are evaluated afterward: an early-warning threshold does not prevent saving a valid backup.

Markers remain version 1 and add `sql_bytes` and `recovery_sql_bytes`. Source size is the actual UTF-8 export length, not ciphertext size, logical customer usage or SQLite file size. The recovery estimate uses the actual column-explicit SQL serializer **before independent erasure-ledger replay**, at the snapshot's measurement time. Replay can add safety metadata, so this is not a guarantee that a later protected restore fits. Keep protected recovery drills. The 20 MiB plaintext and actual recovery ceilings remain enforced.

The hourly watchdog uses `scripts/backup-operations.mjs check`, with its existing list/read-only backup key. Both commands write aggregate JSON, fixed-text GitHub annotations and a job-summary table showing source size, recovery estimate, encrypted bytes, age and remaining space under 20 MiB. No task text, SQL, identities, cookies, key values, private IDs or provider bodies are emitted. The watchdog needs no new D1 or erasure credential.

| Condition, using either SQL measurement | Action |
| --- | --- |
| Below 5 MiB, complete measurements | Report normal size status and headroom. |
| At least 5 MiB | Warning annotation and summary; inspect growth, History/receipts and headroom. |
| At least 10 MiB | Fail the operations job for the configured owner failure notification. Manually pause additional admissions and allowance increases pending capacity review. |
| At least 15 MiB | Fail with an urgent recovery-capacity message; investigate growth immediately. |
| Verified backup at least 22 hours old | Fail the watchdog before the 24-hour recovery target is missed. |
| Invalid marker, missing archive, provider failure or age over 24 hours | Retain the existing failure behavior. |

Job failure uses the existing GitHub notification channel; the 5 MiB warning alone does not generate a failure email. No automatic account changes, billing changes, migrations, erasures or global write freeze occur. A paused or delayed GitHub scheduler can delay both the backup and its watchdog; this remains the previously accepted MVP blind spot.

Older markers with neither measurement remain readable but show **unknown**, with a warning to run a fresh monitored backup. A new marker with incomplete measurements fails monitoring after its archive is verified. If estimating recovery size fails, the source backup is still preserved when valid, and missing recovery headroom is reported as a failure. Corrupt source data or a source over the hard limit still fails validation. Helpers that need policy reporting should use the monitored commands; the low-level `backups.mjs` API/CLI remains available for compatibility and integrity checks.

## Manual reviews that remain required

Start with the current owner only. Before admitting any additional account, review account-wide D1 daily rows across **all** databases, physical storage and other account workloads. Both existing analytics credentials were refused during sizing; a failed analytics request is **unknown usage**, not zero. Use the [D1 analytics dashboard/documentation](https://developers.cloudflare.com/d1/observability/metrics-analytics/) and record the UTC day, reads, writes and storage privately. Do not broaden a runtime or backup key merely to collect analytics. The approved maximum of three pilot accounts remains conditional on that review.

Use the proposed row-review levels in [the sizing assessment](mvp-3-sizing.md): investigate at 2.5 million reads or 50,000 writes in a UTC day, and stop pilot expansion at 3.75 million reads or 75,000 writes or any quota error. These are manual decisions, not newly installed D1 alerts. Recheck the provider's applicable allowances when making a scaling decision.

Review the job-summary sizes weekly and after the first week of pilot use. Record recent source and recovery-estimate values privately. Use observed growth to investigate any forecast that reaches 20 MiB within 30 days; a single snapshot is not a growth forecast. Include retained versions, independent ledger storage and other account resources in the existing cost review. Do not remove retirement receipts, History or erasure protection merely to meet a budget.

Once MVP 3 retention is separately enabled, failures of its existing hourly workflow require attention. During the initial pilot, review backlog after failures and before creating more households. This read-only aggregate query applies **only after** the household migrations; it is not valid against the current MVP 2 production schema:

```sql
SELECT
  (SELECT count(*) FROM household_lifecycle WHERE closure_published=0)
    AS pending_closure_publications,
  (SELECT count(*) FROM households
    WHERE status IN ('closed','erasing') AND erase_due_at<=unixepoch())
    AS due_households,
  (SELECT count(*) FROM households
    WHERE status IN ('closed','erasing') AND erasure_delayed=1)
    AS delayed_households;
```

Inspect more than ten pending closures/due erasures, or the same due household remaining across two hourly maintenance runs. Check individual content-free IDs privately when distinguishing persistent work from new arrivals. Retain reserved allocations until protected erasure succeeds. Backlog counts and two-run tracking are manual; the existing maintenance response reports completed work and failures, not a complete backlog metric. This package does not enable `HOUSEHOLD_OPERATIONS_ENABLED`.

## Validation and activation

Regression tests cover marker compatibility and malformed measurements, exact size/age boundaries, preservation when estimation fails, equality with a real upgraded encrypted restore, and an under-budget source whose serialized recovery exceeds 20 MiB while the real restore still rejects it. A regression reads the actual workflow schedule and checks every normal interval, including midnight, immediately before the next backup is due; it reproduced the original cadence conflict and passes with twice-daily backups. Use the existing approved backup/recovery test boundary; local browser coverage is unrelated to this operator-only change.

Before declaring monitoring active, require exact-revision CI, run a normal monitored backup, require its real export/encrypt/readback step to succeed, then run the watchdog and inspect its summary. Download that new archive privately, check that its recorded sizes match the plaintext and recovery measurement, and rehearse protected recovery in isolation. Do not substitute an intentionally failed notification test or a skipped job. New monitoring publication does not authorize the first MVP 3 database upgrade or application launch.
