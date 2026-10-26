# Rust Everyday lists API

MVP 3.1 adds normal invitation-only accounts, independent safety budgets, owner metadata administration, durable SES delivery and signed feedback. Migration does not activate this mode. See the [release preparation](../docs/mvp-3-1-release.md) for migrations 0015–0024, schema version 4, provider settings and the separate launch gates. Use `npm run dev:normal` for isolated local review with fake email and illustrative policy; existing pilot behavior below remains available until explicit policy activation.

Native Axum serves generated ConnectRPC task and Everyday lists methods from [`/proto`](../proto/life/v1/tasks.proto). Google Identity Services exchanges a verified ID token for an opaque, revocable seven-day session. Operator-approved stable Google subjects may sign in; the configured original owner is the bootstrap identity. Personal data is isolated per subject, and household access requires current head membership. Tasks and hashed session tokens live in D1; the server has no durable local filesystem dependency.

Run `npm run dev` from the repository root to start local D1, the Rust server on `127.0.0.1:8788`, and Astro on `127.0.0.1:4322`. Install root and web npm dependencies first. Local data lives under `server/local/.wrangler`; isolated integration/browser tests use temporary directories. Stop the complete development stack before running integration or browser tests because they use the same ports.

The local login route requires both a `dev-auth` build and `APP_ENV=development`. Development binds loopback and uses a fixed loopback database bridge. Normal builds have no development login route and reject a development environment; development-auth builds refuse production configuration. Never deploy the local bridge or a development-auth binary.

Production reads the variables listed in [`.env.example`](.env.example) from its environment; it does not automatically read an env file. `WEB_ORIGIN` must be an exact HTTPS origin. Deploy the API and web client under HTTPS subdomains of the same site, such as `api.intrepion.com` and `intrepion.com`. The host-only `Secure`, `HttpOnly`, `SameSite=Lax`, `__Host-` cookies intentionally do not depend on third-party cookies across `pages.dev` and `onrender.com`.

Google login uses a short-lived, single-use nonce bound to an HTTP-only API cookie, exact-origin checks, a fixed Google JWKS endpoint with cache-control handling, and RS256 signature/audience/issuer/expiry/nonce validation. Pilot admission uses `sub`, never the email address. Approval revocation invalidates sessions; household departure/removal ends subsequent shared access while preserving the personal session. The callback uses the SDK's JavaScript credential response and our nonce exchange; it is not the SDK-managed redirect POST flow. Mutating session endpoints and all task RPCs additionally require the configured origin and session CSRF token. Tokens, task text, SQL, provider response bodies, and request headers are excluded from application logs.

MVP 2 adds shopping lists, independent checklist runs, sections, change history, Archive, and reversible Trash through `ListService`. The original TaskService remains a compatibility adapter over the canonical collections; its DeleteTask method now moves a task to Trash. Migration and erasure-aware recovery requirements are in [the release guide](../docs/mvp-2-release.md). The independent ledger has no production filesystem dependency.

The client generates an action UUID for creation and retains it through retries. Updates use a revision and an explicit desired state. Replaying an identical write is safe; stale different edits fail instead of overwriting newer data. Moving to Trash requires the observed task revision; stale removal fails. Repeated removal succeeds after the task is absent from active lists. Permanent erasure is separate and requires confirmed independent ledger publication before content/history removal. Retired identifiers prevent delayed create retries from resurrecting erased content. A different draft under an already-created action ID is rejected and retained for reconciliation. There is no automatic retry of a possibly committed D1 request.

`/auth/config` reports the content-free schema version and whether erasure storage is configured; configuration presence does not prove provider access. `/health/live` checks the process only. It does not claim D1 or Google availability. Database and request JSON logs report durations, fixed operation names, status, and success without user content. Operator measurement and launch checks are in [the operations guide](../docs/operations.md).

Local verification:

```sh
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo clippy --locked --all-targets --features dev-auth -- -D warnings
cargo test --locked
cargo build --locked --release
npm run test:integration
```

Integration tests use generated TypeScript clients, real Rust HTTP requests, and Wrangler's local D1 SQLite. JWT tests use a public RSA fixture, not Google credentials. Production verification uses AWS-LC; CMake is a build prerequisite. The pinned versions in `.node-version` and `rust-toolchain.toml` apply to local checks and CI. The owner identity replacement procedure is in the operations guide. Live Google login, actual Cloudflare REST behavior, cold starts, and provider limits remain deployment checks.

MVP 3 adds `HouseholdService` for explicit space selection, invitations, individual count ceilings, capacity contributions, independent copies and final closure. Shared writes recheck membership and resource/structural budgets in the D1 transaction. The `x-space-id` header selects a household UUID; absent/`personal` selects only the authenticated person's private space. A caller cannot use a data-owner identifier to select another person's personal data.

`PilotOperatorService` and `HouseholdMaintenanceService` use different optional private bearer credentials; Google cookies authorize neither service. The operator endpoint is disabled without `PILOT_OPERATOR_TOKEN`; scheduled retention requires `HOUSEHOLD_MAINTENANCE_TOKEN`. Do not expose either in a client build. See [operator procedures](../docs/mvp-3-operator.md) and [closure/retention](../docs/mvp-3-retention.md). Production numerical policy and deployment remain separate approval gates.
