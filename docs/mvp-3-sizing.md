# MVP 3 usage assessment and proposed pilot limits

Status: **proposal awaiting owner approval**. Measurement: 2026-10-24 04:09 UTC (2026-10-23 Pacific). No production data, plan, admission, deployment, credentials, spending controls or provider settings were changed. These are manually assigned capacity allowances, not subscription prices or a paid offering.

## Measured production baseline

| Measurement | Result |
| --- | ---: |
| Owners with retained content | 1 |
| Retained tasks and list items combined | 9 items; 0 tasks |
| Shopping lists / templates / runs | 1 / 0 / 0 |
| Archived or trashed collections / trashed items | 0 / 0 |
| Sections; largest retained collection | 0 sections; 9 items |
| Content History / operation receipts / retired list IDs | 11 / 16 / 10 |
| Logical retained content and History | 1,433 bytes (1.40 KiB) |
| D1 physical database size | 167,936 bytes (164 KiB) |
| Latest verified plaintext SQL export | 22,617 bytes (22.09 KiB) |
| Corresponding encrypted backup | 22,817 bytes (22.28 KiB) |
| Backup objects under the authorized `daily/` prefix | 26 uploaded versions; 71,540 bytes total |

The latest verified backup was created at **2026-10-23 09:23:59 UTC**, approximately 18.76 hours before measurement. Its checksum, local decryption and isolated SQL integrity/schema verification passed. Its retained counts, logical bytes and History count match the live aggregates; this does not establish byte-for-byte equality or exclude changes after measurement. No private titles, notes, Google subjects, account/database IDs, tokens or plaintext exports were written to this report. Backup-prefix totals exclude the independent erasure ledger, other buckets and unrelated account resources.

The live database has none of the MVP 3 household/plan tables: production still runs MVP 2. Applying the remaining migrations to the backup **only in memory** succeeded. The resulting compact local SQLite dump is 33,448 bytes and its local SQLite page footprint is 331,776 bytes. These are local estimates, not a new provider export or a recovery drill; the independent erasure ledger was not replayed for this sizing exercise, and no restored SQL or application was published.

The live aggregate query reported **108 rows read, zero rows written**, and about 2.13 ms provider SQL execution. That is one measurement query, not daily account usage. Both existing credentials attempted for D1 analytics returned “not authorized for that account.” No permissions were broadened. Daily D1 reads/writes and shared account headroom therefore remain unmeasured and require an operator dashboard check before admitting additional users.

## Proposed initial plan

Apply one manually assigned plan to each approved pilot user, after approval. Resources allocated to a household are reserved from that user's plan; they are not additional capacity. Personal content and household allocations share the same resource budget. Household contributions sum by resource. Individual head count ceilings remain separate; there is no individual byte ceiling.

| Plan resource | Proposed allowance |
| --- | ---: |
| Retained tasks and list items combined | **250** |
| Shopping lists | **10** |
| Checklist templates | **10** |
| Checklist runs | **25** |
| Logical retained content and History | **131,072 bytes (128 KiB)** |
| Simultaneous households headed | **2** |

Archive, Trash, finished runs and independent copies continue to count. Trashed content is not free capacity. Existing usage fits with about 27.8 times its item count and 91.5 times its logical bytes available before any allocation. History growth can consume the storage allowance before the count limits; the UI must not promise that all maxima with arbitrary notes fit simultaneously.

Uniform structural caps, independent of contributions: **100 retained items per collection** and **20 sections per collection**. The current maximum is nine items and zero sections. These caps preserve the approved rule that contributions do not multiply structural limits.

Admission policy: initially the current owner; expand deliberately to **at most three approved accounts total** after reviewing daily D1 usage and remaining free-account headroom. This is an operator admission policy, not a new enforced global account cap. More users or a larger plan require another sizing review. Head membership limits apply to creation and acceptance; closed households are not active memberships, and their allocations remain held until protected erasure succeeds.

## Why these values

The existing backup is only about **0.108%** of the hard 20 MiB plaintext export budget. That small baseline is insufficient justification for generous customer storage limits: schema and identifiers dominate a small database, and History/receipt amplification changes with workload.

[`scripts/calibrate-mvp3.py`](../scripts/calibrate-mvp3.py) builds synthetic current-schema databases entirely in memory. It exercises retained row shapes for three fully allocated household spaces, all 45 allowed shopping/template/run collections per user, up to 250 items per user, and small section renames until each logical byte allowance is nearly full. One scenario has all 20 sections per collection; other scenarios use everyday text or Unicode/apostrophe/quote-rich notes. Tiny section-renaming events use the application's `Section renamed` History shape and a separate receipt per operation. Each fixture checks resource totals, foreign keys, integrity and empty temporary write budgets. Writer contexts are fixture setup, not proof of production quota enforcement; existing API/browser tests cover that behavior.

The tool measures both compact SQLite SQL and a column-explicit SQL estimate matching the row representation used by recovery. Neither is asserted to be the byte-identical Cloudflare export. Synthetic scenarios omit managed D1 internals and do not bound all ancillary metadata. The larger format is used for conservative **recovery** headroom as well as backup planning. Results are in [the reproducible synthetic report](research/mvp-3-synthetic-sizing.json).

| Three-user scenario | 128 KiB per user: compact SQL | 128 KiB per user: column-explicit SQL |
| --- | ---: | ---: |
| Many short section renames, maximum section counts | 7,157,150 bytes | **9,979,028 bytes (9.52 MiB)** |
| Everyday text followed by small edits | 5,471,677 bytes | 7,628,993 bytes (7.28 MiB) |
| Unicode and quote-rich notes | 943,878 bytes | 1,152,965 bytes (1.10 MiB) |

The densest tested case uses **47.6%** of the 20 MiB budget, leaving about 10.48 MiB for further schema/metadata differences and operational headroom. This is a measured scenario margin, not a mathematical worst-case guarantee. The account plan's logical bytes are not interchangeable with SQL export bytes or SQLite file size.

For comparison, **256 KiB per user with three accounts** produces 21,075,272 bytes of column-explicit recovery SQL in the short-edit case—**103,752 bytes above** the current recovery budget. Do not adopt 256 KiB or the illustrative 2 MiB development plan just because the current live database is small. One larger-account plan could be assessed separately; no higher allowance is proposed here.

A separate metadata-churn fixture retains 10,000 erased-collection identifiers and erasure receipts per account. With three accounts it has just three logical bytes from household names but **12,924,638 bytes of column-explicit SQL**. It excludes the independent offsite ledger. This demonstrates that content quotas do not cap lifetime safety metadata. Administrative activity, invitations, sessions and repeated closed households also need monitoring. Never prune retirement receipts or erasure-ledger records merely to fit a budget; that could weaken recovery protection.

All seven recorded synthetic scenarios reproduce, and the dense 128 KiB compact dump passes the current backup schema/integrity validator after an isolated restore. The provider-fact researcher also checked the arithmetic and source alignment. No application or CI behavior was changed.

Reproduce without credentials or network access:

```sh
python3 scripts/calibrate-mvp3.py
python3 scripts/calibrate-mvp3.py --bytes-limit 262144
python3 scripts/calibrate-mvp3.py --erased-collections 10000
```

## Proposed review and scaling triggers

These thresholds are **operator procedures to approve and configure**, not newly installed automated alerts. Keep the existing hard budgets and provider spending controls unchanged; do not upgrade automatically.

| Signal | Proposed response |
| --- | --- |
| Plaintext export or recovery-format estimate reaches **5 MiB** | Review weekly growth, History/receipt composition and remaining recovery margin. |
| Either reaches **10 MiB** | Pause new admissions and allowance increases; review storage layout, archive/recovery budget and migration options before expanding. |
| Either reaches **15 MiB**, or forecast reaches 20 MiB within 30 days | Urgent capacity/recovery review; coordinate a pause in growth with trusted pilot users. Preserve viewing and protected erasure; no automatic deletion. |
| Daily account-wide D1 usage reaches **2.5 million reads or 50,000 writes** | Review query costs and other account workloads; optimize the largest scans first. |
| Daily account-wide usage reaches **3.75 million reads or 75,000 writes**, or any quota error occurs | Stop expanding the pilot and choose a tested optimization or scaling plan before the daily ceiling is reached. |
| Pending closures or due erasures exceed **10**, or a due erasure remains pending across two hourly maintenance runs | Inspect protection/provider failures and backlog before creating more households; retain allocations until protected completion. |
| Latest verified backup reaches **22 hours** old, or scheduled maintenance fails | Act on existing GitHub failure notifications; verify recovery rather than increasing storage limits. |

The initial model is for a small, trusted, invitation-only pilot. It is not sufficient for unrestricted signup or sustained adversarial churn. A daily account quota can be consumed even when the SQL export is small, because metering and History scans read rows repeatedly. Storage limits alone cannot promise request throughput or availability.

Review aggregate backup sizes and daily rows after the first week, before each new pilot admission, and before increasing any allowance. Re-run sizing after schema/history changes. Before launch, add size/headroom reporting to the existing GitHub operations checks or establish and explicitly accept the equivalent manual review; the current hard 20 MiB failure alone is late warning. No extra paid monitoring service is proposed.

## Provider and cost boundary

[Current official provider facts](research/mvp-3-sizing-provider-facts.md) distinguish D1's nominal Free storage/row allowances from the much smaller application backup budget. The current provider plans, no-trial assessment, $0 target and agreed $10 spending ceiling remain unchanged. No paid service or billing change was made. This is not an invoice audit or a guarantee of $0 account-wide costs: B2 download traffic, retained versions/ledger objects, other account resources and shared quotas require ongoing observation. The authorized daily backup prefix is currently only about 69.9 KiB across all listed uploaded versions.

## Approval requested

Approve or amend the **250 / 10 / 10 / 25 / 128 KiB / 2** per-user plan, the **100 items / 20 sections** structural caps, the **three-account admission ceiling with daily-usage review**, and the review triggers above. This proposal does **not** authorize production assignment, migration, credential setup or deployment; those steps follow separately after the values and hosted release plan are approved.
