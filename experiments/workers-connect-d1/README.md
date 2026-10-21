# Workers / ConnectRPC / D1 feasibility experiment

**Result: partial compatibility; not eligible for the MVP as tested.** Basic RPCs and D1 work, but requests with deadlines panic in `connectrpc 0.9.1` on `wasm32-unknown-unknown`. The same deadline probes pass against the native Rust/Axum comparison server. See [results](../../docs/experiments/0001-workers-connect-d1.md).

This is isolated technical evidence, not `/server`, `/web`, or the website design prototype. It contains synthetic data and a local test identity, not Google OAuth. Do not deploy it or reuse its authentication, unpaginated listing, or simplified write logic in production.

## Prerequisites

- Rust with the `wasm32-unknown-unknown` target; tested with rustc 1.99.1.
- `worker-build` 0.8.7; its packaging tools download on first use.
- Node.js/npm; tested with Node 26.12.0 and npm 11.20.0.
- `protoc`; tested with 36.1.

```sh
rustup target add wasm32-unknown-unknown
cargo install worker-build --version 0.8.7 --locked
npm ci
cargo fetch --locked
cp .dev.vars.example .dev.vars
npm run generate:ts
```

Run commands from this directory. Keep `worker-build` on `PATH`. The Rust and npm lockfiles pin dependencies; Rust bindings are generated during the build. Generated TypeScript is committed so both client and server use the same source schema. Rust features deliberately omit native server, native TLS, and compression dependencies in the Worker build. `--no-opt` skips the optional wasm-opt packaging step, not Cargo's release optimizations.

## Worker checks

```sh
WRANGLER_SEND_METRICS=false npx wrangler d1 migrations apply DB --local
WRANGLER_SEND_METRICS=false npm run dev
```

The development server binds to `127.0.0.1:8787`. D1 uses Wrangler's local emulator, fake database ID, and ignored `.wrangler/` state. No Cloudflare account is required. `.dev.vars` enables the synthetic `Bearer local-owner` test identity and is not deployed by Wrangler; the fetch handler returns 503 without that opt-in. This is an experiment guard, not a production authentication design.

In another terminal:

```sh
npm run typecheck
npm run test:integration
npm run test:deadlines
```

**Both test commands are acceptance checks.** Six integration tests pass. Both deadline tests fail against Workers; that nonzero exit is a failed compatibility requirement, not an expected error to suppress. The second deadline probe uses a protocol timeout header without a client timer, so a client-side timeout cannot disguise the missing server behavior.

The origin checks exercise preflight and Origin-bearing requests with the web transport from Node; they are not a full browser E2E test. Only `http://localhost:4321` receives CORS permission.

## Persistence and recovery

With the Worker running:

```sh
npm run probe:persistence -- seed
```

Stop the development server completely, then start it again with the same local state. In the second terminal:

```sh
npm run probe:persistence -- check
npm run probe:recovery
npm run probe:persistence -- cleanup
```

Recovery exports the synthetic `tasks` table and imports it into a separate temporary D1 storage directory, then asserts the sentinel record's contents. Every Wrangler database command is explicitly local. The printed `/tmp/intrepion-d1-restore-*` directory contains only synthetic SQL and can be inspected. This does not test encryption, B2 upload, hosted Time Travel, backup scheduling, or notification delivery.

## Native deadline comparison

```sh
cargo run --offline --locked --features native-baseline --bin native-baseline
```

This binds to `127.0.0.1:8788` and implements only Echo using the same Connect library and generated messages. It intentionally has no database or authentication and is not the native production implementation. In another terminal:

```sh
EXPERIMENT_API_URL=http://127.0.0.1:8788 npm run test:deadlines
```

Both tests pass: a short request with a five-second deadline succeeds, and a 100 ms handler with a 20 ms server deadline returns structured `deadline_exceeded`.

## Static checks

```sh
cargo fmt --check
cargo clippy --offline --locked --target wasm32-unknown-unknown -- -D warnings
npm run typecheck
```

No cloud services, payment methods, Google credentials, production workflows, or public repository settings are created by this experiment.
