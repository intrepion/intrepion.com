# Initial hosting assessment

Research checked 2026-10-20. After the three-way comparison and local experiments, native Axum on Render + D1 is selected for MVP design; see [ADR 0003](adr/0003-native-axum-with-d1.md). No accounts have been provisioned, and hosted validation remains outstanding. Only recurring free allowances count; no trial credits are included. Quotas and terms must be rechecked before provisioning.

## Three-way comparison

All three can plausibly run the small personal MVP within recurring $0 allowances. This is an assessment, not a completed deployment or interoperability test. A static TypeScript frontend on Pages is compatible with all three directions; backup storage and monitoring are separate components.

| Concern | Render + Neon | Render + D1 | Rust Workers + D1 |
| --- | --- | --- | --- |
| Rust execution | Conventional native binary | Conventional native binary | Rust compiled to Wasm, called through a Worker fetch handler |
| Database integration | Standard Postgres driver | Authenticated D1 REST requests | D1 binding via workers-rs |
| Idle behavior | API sleeps after 15 minutes; Neon also suspends idle compute | API sleeps after 15 minutes | Avoids Render's idle spin-down mechanism; startup/latency still need measurement |
| Local development | Native Rust plus local Postgres | Native Rust plus local D1 HTTP emulation/adapter work | Wrangler local Workers runtime and local D1 |
| Principal additional limits | Render hours/bandwidth/builds; Neon compute/storage/egress | Render limits; D1 daily SQL rows and REST rate limits | Workers Free CPU/request/memory limits; D1 daily SQL rows/storage |
| Portability | Most conventional native stack and database protocol | Native API, but Cloudflare-specific database adapter | Worker runtime adapter and D1 binding are Cloudflare-specific |
| Current evidence | Native deadline baseline passed; Postgres integration remains untested | Eight local checks plus restart/recovery and HTTP error tests passed through a local D1 HTTP bridge; live gateway untested | Ordinary RPCs, local D1 CRUD, persistence and restore passed; both deadline probes failed with a Rust panic |

Workers Free currently allows 100,000 requests/day, 10 ms CPU per HTTP invocation, and 128 MB memory. Waiting on network/database I/O does not count as CPU time. Authentication verification, protobuf processing, and serialization must fit the CPU budget; do not infer success solely from low request volume. See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).

The official [workers-rs HTTP integration](https://github.com/cloudflare/workers-rs#http-feature) accepts standard HTTP bodies and documents Axum use. The [Connect Rust manifest](https://github.com/connectrpc/connect-rust/blob/main/connectrpc/Cargo.toml) separates its Axum feature from its native socket-based server feature, and its core has Wasm-specific paths. This supports investigating an adapter without the native server feature; it does not prove the adapter works. In particular, body conversion, async Send bounds, timers, cancellation, compression features, and browser interoperability need checks.

### Accepted feasibility sequence (final architecture remains open)

Investigate Workers + D1 first because it resolves the greatest uncertainty and could remove the API's minute-long idle restart. Avoid three complete implementations. Use one tiny generated unary Connect service and a tiny task record, with no product UI and no production credentials.

Acceptance evidence must include:

1. A reproducible Wasm build using the existing Connect implementation, without a handwritten replacement protocol.
2. A generated TypeScript client calling the service in the local Workers runtime, including structured errors, authentication checks with a test identity provider, and browser-origin handling.
3. Local D1 migration and create/read/update/delete behavior, persistence across runtime restarts, and an export/restore check.
4. No dependency on unavailable native sockets, threads, or runtime timers; exercise deadlines/cancellation and use explicit supported compression settings.
5. Separate hosted Free-tier checks for real Google login and CPU/memory/latency. Local execution alone cannot establish hosted CPU compliance or Google OAuth readiness.
6. A native baseline if the Worker integration is fragile or fails, with documented reasons rather than silently dropping Rust or ConnectRPC.

Both local experiments have now run. The [Workers experiment](experiments/0001-workers-connect-d1.md) failed deadline handling, while the [native Axum + D1 HTTP experiment](experiments/0002-native-axum-d1.md) passed the shared eight checks, adapter error fixtures, restart persistence, and export/restore. The native-to-D1 path used a loopback bridge to the actual local D1 emulator, not the hosted REST gateway. Provider accounts and hosted validation remain later setup steps.

## Native Rust candidates

| Component | Candidate | Important constraint |
| --- | --- | --- |
| Rust API | Render Free | Sleeps after 15 idle minutes; restart takes about a minute. Local files are ephemeral. Without a payment method, bandwidth exhaustion suspends services rather than billing. |
| Alternative Rust API | Koyeb Free | One small instance; sleeps after an hour; no persistent volume. |
| Durable database | Neon Free Postgres | Recurring free plan with compute, storage, and transfer allowances; idle compute suspends. Free-tier exhaustion can suspend access. |
| Static TypeScript website | Cloudflare Pages Free | Static build; no Astro server-side runtime required. Build and file limits apply. |

Sources: [Render](https://render.com/docs/free), [Koyeb instances](https://www.koyeb.com/docs/reference/instances), [Neon plans](https://neon.com/docs/introduction/plans), [Pages limits](https://developers.cloudflare.com/pages/platform/limits/).

Do not store a durable SQLite database on an ephemeral free API filesystem. Render's free Postgres expires after 30 days and is therefore excluded from the recurring-free assessment. Render describes its free instances as hobby/testing services rather than production infrastructure; accepting this for a personal MVP requires an explicit reliability trade-off.

## Reopened database comparison: Neon versus D1

D1 is a managed remote database with SQLite SQL semantics, not a SQLite file the Rust server can mount. Cloudflare explicitly supports querying it from non-Workers applications through its authenticated HTTP REST API, so a native Rust/Axum server on Render can use D1; this requires an HTTP database adapter instead of an ordinary SQLite file connection. Worker bindings provide a different integration with better performance and fewer restrictions; these trade-offs need measurement rather than assumptions.

D1 on Workers Free includes 5 million rows read/day, 100,000 rows written/day, and 5 GB total storage, with a 500 MB per-database limit. Free-tier queries stop at the daily limits rather than generating paid overages. D1 has no database egress charge. Its REST path also inherits Cloudflare API rate limits, which must be considered separately from SQL-row allowances.

D1 Free includes seven days of same-provider Time Travel recovery. Independent SQL exports are supported through Wrangler or the REST API, but export temporarily blocks database queries and a separate private backup destination is still required. Time Travel alone does not satisfy the agreed independent encrypted-backup policy.

Both Neon and D1 have recurring free offerings. The task domain does not require Postgres. Compare database integration effort, local-development parity, spending controls, recovery, and measured latency before selecting a database; do not impose local Postgres before resolving this choice. A Workers-based Rust/Wasm architecture is a possible further alternative but would reopen the accepted native-server hosting direction and require validating ConnectRPC/runtime compatibility.

Sources: [D1 overview](https://developers.cloudflare.com/d1/), [querying via bindings or REST](https://developers.cloudflare.com/d1/best-practices/query-d1/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [Cloudflare API limits](https://developers.cloudflare.com/fundamentals/api/reference/limits/), [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/), [Rust Workers](https://developers.cloudflare.com/workers/languages/rust/).

## Backups remain unresolved

Daily encrypted Postgres dumps into a private Cloudflare R2 Standard bucket could fit its recurring free allowance. However, R2 is metered and overages are billed: a free allowance is not a guaranteed $0 spending cap. Retention limits in application code and spending alerts do not establish a provider-enforced cap. Do not adopt it until the owner resolves this policy and backup controls are verified.

Daily dumps also consume database outbound-transfer allowance, so database size alone is insufficient for capacity planning. Backup encryption requires an independently recoverable decryption key; do not put the sole key on the application host.

GitHub Actions scheduled backups are best effort. Scheduled runs can be delayed or dropped, and schedules in a public repository disable after 60 days without repository activity. A daily cron expression alone does not guarantee the backup-age target. The owner selected a separate hourly GitHub Actions backup-age watchdog with native failure-email notifications, accepting that both workflows share the GitHub scheduler dependency.

Sources: [Neon dump/restore](https://neon.com/docs/manage/backup-pg-dump), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [workflow inactivity](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows), [workflow troubleshooting](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows).

### Backup candidate and monitoring choices

Backblaze B2 advertises recurring free storage and signup without a card. Unlike R2, B2 documents enforceable storage and Class A/B/C transaction spend caps, and APIs report cap-exceeded errors. Class D operations cannot be capped: leave Event Notifications disabled and verify all applicable spending controls before adopting it. A marketing free allowance alone is not proof of a zero-dollar cap; actual account configuration remains a prerequisite. Keep the bucket private, encrypt dumps before upload, constrain retention, and account for hidden/old object versions.

Healthchecks.io's recurring free Hobbyist plan includes 20 checks and email notifications. A private backup job can send a secret success ping only after upload verification; a missing ping then alerts independently of the application and GitHub scheduler. It does not require repeatedly waking the API/database. A periodic deeper restore drill is still necessary: a successful upload alone does not prove restoration works. Choose a schedule and grace window that visibly report breaches of the 24-hour backup-age target.

B2 is now the accepted backup candidate, conditional on verification of no-card operation and zero-dollar controls at setup. GitHub-only monitoring is selected for MVP 1; Healthchecks.io and other external services are deferred. See [monitoring choices](monitoring-assessment.md). Sources: [B2 signup](https://www.backblaze.com/cloud-storage), [B2 spend caps](https://www.backblaze.com/docs/en/cloud-storage-data-caps-and-alerts), [B2 cap errors](https://www.backblaze.com/apidocs/b2-get-upload-url), [Healthchecks pricing](https://healthchecks.io/pricing/), [heartbeat monitoring](https://healthchecks.io/docs/monitoring_cron_jobs/).

## Google identity constraint

Enforce owner-only authorization in the Rust server using Google's stable subject identifier (`sub`). OAuth console Testing mode is not an application access-control mechanism; the basic identity-scope exception permits sign-in beyond the testing allowlist. Email alone is not a stable identity key.

Sources: [Google production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview), [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).
