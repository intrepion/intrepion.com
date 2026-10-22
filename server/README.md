# Rust task API

Native Axum serves generated ConnectRPC task methods from [`/proto`](../proto/life/v1/tasks.proto). Google Identity Services exchanges a verified ID token for an opaque, revocable seven-day session. Only the configured stable Google `sub` is allowed. Tasks and hashed session tokens live in D1; the server has no durable local filesystem dependency.

Run `npm run dev` from the repository root to start local D1, the Rust server on `127.0.0.1:8788`, and Astro on `127.0.0.1:4322`. Install root and web npm dependencies first. Local data lives under `server/local/.wrangler`; isolated integration/browser tests use temporary directories. Stop the complete development stack before running integration or browser tests because they use the same ports.

The local login route requires both a `dev-auth` build and `APP_ENV=development`. Development binds loopback and uses a fixed loopback database bridge. Normal builds have no development login route and reject a development environment; development-auth builds refuse production configuration. Never deploy the local bridge or a development-auth binary.

Production reads the variables listed in [`.env.example`](.env.example) from its environment; it does not automatically read an env file. `WEB_ORIGIN` must be an exact HTTPS origin. Deploy the API and web client under HTTPS subdomains of the same site, such as `api.intrepion.com` and `intrepion.com`. The host-only `Secure`, `HttpOnly`, `SameSite=Lax`, `__Host-` cookies intentionally do not depend on third-party cookies across `pages.dev` and `onrender.com`.

Google login uses a short-lived, single-use nonce bound to an HTTP-only API cookie, exact-origin checks, a fixed Google JWKS endpoint with cache-control handling, and RS256 signature/audience/issuer/expiry/nonce validation. Owner authorization uses `sub`, never the email address. The callback uses the SDK's JavaScript credential response and our nonce exchange; it is not the SDK-managed redirect POST flow. Mutating session endpoints and all task RPCs additionally require the configured origin and session CSRF token. Tokens, task text, SQL, provider response bodies, and request headers are excluded from application logs.

The client generates an action UUID for creation and retains it through retries. Updates use a revision and an explicit desired state. Replaying an identical write is safe; stale different edits fail instead of overwriting newer data. Deletion requires the observed task revision; stale deletion fails. Repeated deletion is successful after the task is absent. Minimal deleted-ID receipts survive task deletion and prevent old create retries from resurrecting tasks; deleted titles and notes are not retained in those receipts. A different draft under an already-created action ID is rejected and retained for reconciliation. There is no automatic retry of a possibly committed D1 request.

`/health/live` checks the process only. It does not claim D1 or Google availability. Database and request JSON logs report durations, fixed operation names, status, and success without user content. Operator measurement and launch checks are in [the operations guide](../docs/operations.md).

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
