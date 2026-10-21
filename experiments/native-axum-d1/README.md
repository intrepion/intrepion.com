# Native Axum + D1 HTTP experiment

**Local result: passed.** The same generated TypeScript client now passes all eight integration/deadline checks against native Rust/Axum. Two Rust tests cover the adapter's request contract and ten defensive error fixtures. Restart persistence, export/restore, and a disconnected-upstream probe also pass. See [results](../../docs/experiments/0002-native-axum-d1.md).

This isolated experiment is not `/server` and has no production authentication. It cannot deploy to Render or use a real Cloudflare account as configured. Both endpoints bind to loopback and use synthetic identities; no cloud credentials are needed.

## How local development works

```text
Generated TypeScript client
  -> native Rust/Axum on 127.0.0.1:8790
  -> HTTP query adapter
  -> local bridge on 127.0.0.1:8791
  -> Wrangler's local D1 / SQLite state
```

The bridge presents the documented REST query-envelope subset and delegates SQL to the actual local D1 binding. It is a development shim, **not Cloudflare's REST gateway**. Its behavior does not prove remote authentication, every gateway error, rate limits, or latency between Render and Cloudflare. In production, the native HTTP adapter would call Cloudflare directly; no bridge Worker would be deployed.

The adapter uses string parameters to match the published REST schema. SQLite affinity converts bound `"0"`/`"1"` values for the strict integer completion column. Each task mutation is one SQL statement with `RETURNING`; no cross-request transaction guarantee is assumed. Writes are not automatically retried because an interrupted response does not prove the write failed.

## Setup

Run from this directory. Requires native Rust, Node/npm, and `protoc`; **no Wasm target or worker-build is required**. The client tools and Wrangler are reused from the prior experiment's locked npm package:

```sh
npm --prefix ../workers-connect-d1 ci
npm --prefix ../workers-connect-d1 run generate:ts
cargo fetch --locked
cp .dev.vars.example .dev.vars
WRANGLER_SEND_METRICS=false npm run db:migrate
```

Run the local bridge in one terminal:

```sh
WRANGLER_SEND_METRICS=false npm run db:dev
```

Run the native API in another:

```sh
npm run dev
```

`npm run dev` explicitly opts into the local synthetic identity. Running the binary without `EXPERIMENT_LOCAL_ONLY=true` exits before opening a socket. Neither this opt-in nor `Bearer local-owner` is a Google authentication implementation. The separate `local-d1-token` belongs only to the native-to-bridge hop and is never supplied to the web client.

In a third terminal:

```sh
npm run test:integration
cargo test --offline --locked
cargo fmt --check
cargo clippy --offline --locked --all-targets -- -D warnings
npm --prefix ../workers-connect-d1 run typecheck
```

Both test suites must pass. HTTP fixture tests use temporary loopback servers; they require local socket permission. The shared origin tests assess the CORS permission header, not whether a denied preflight has a particular HTTP status.

## Restart and recovery

```sh
npm run probe:persistence -- seed
```

Stop both processes completely, start them again with the same local state, then:

```sh
npm run probe:persistence -- check
npm run probe:recovery
npm run probe:persistence -- cleanup
```

The recovery helper exports the synthetic tasks table and verifies a restore into a separate temporary local D1 storage directory. No backup encryption, B2 upload, or hosted recovery is implied.

To test an unavailable database, leave the native API running, stop the bridge, then run:

```sh
npm run probe:upstream-down
```

It asserts a sanitized Connect `unavailable` response. Restart the bridge afterward or stop both processes. No periodic health probes are needed to keep the hosted API or database awake.
