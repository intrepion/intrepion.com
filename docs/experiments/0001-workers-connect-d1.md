# Workers + ConnectRPC + D1: local feasibility results

Run on 2026-10-20 after the owner confirmed the plan in Q33. The experiment lives in [experiments/workers-connect-d1](../../experiments/workers-connect-d1/README.md). No cloud account or production resource was used.

## Outcome

The tested Workers stack fails the deadline compatibility requirement. Do not select it for MVP 1 based on successful compilation or ordinary task requests. A native Rust runtime passes the same deadline probes, supporting investigation of the already-agreed Render alternatives without patching the RPC library or silently removing timeout semantics.

| Check | Actual result |
| --- | --- |
| Release Rust/Wasm packaging for the local Workers runtime | Passed |
| Generated TypeScript client, JSON and binary protobuf | Passed |
| Missing identity and wrong identity produce structured errors | Passed with synthetic local identity |
| D1 create/list/edit/complete/reopen/delete | Passed |
| Duplicate, missing, and invalid task structured errors | Passed |
| Local Origin preflight and origin-bearing RPC | Passed from Node; no real browser E2E run |
| Task survives complete local runtime shutdown/restart | Passed |
| SQL export and restore into separate local storage | Passed, sentinel contents verified |
| Workers request with explicit client deadline | Failed: HTTP 500 and Rust clock panic |
| Workers slow request with raw server timeout header | Failed: HTTP 500 instead of structured deadline error |
| Native baseline: same two deadline probes | Both passed |
| Rustfmt, Wasm Clippy with warnings denied, TypeScript typecheck | Passed |

The integration suite has six passing tests, plus separate successful persistence/recovery probes. The deadline acceptance suite has two failing tests on Workers and two passing tests on the native baseline. It remains a failing acceptance suite for Workers; it was not changed to expect HTTP 500 or disabled to make the stack appear compatible.

## Confirmed cause

On `wasm32-unknown-unknown`, a request with a Connect timeout reaches `connectrpc::service::absolute_deadline`, which calls `std::time::Instant::now()`. The local runtime reports a panic in Rust's unsupported time implementation: `time not implemented on this platform`. Its request terminates with HTTP 500.

The locked `connectrpc 0.9.1` source also uses `tokio::time::timeout_at` for enforcement. The first panic prevents validating that next step on Workers. Normal no-deadline requests do not traverse this path, explaining the successful ordinary RPC tests. The native baseline verifies that the client and wire headers work and that this library handles those deadlines under a normal Tokio runtime.

No headers were stripped, deadlines ignored, protocol replaced, or upstream dependencies patched to disguise the limitation. Existing Workers SDK `SendFuture` bridges D1's JavaScript futures into the generated service's Send requirement; no custom unsafe implementations were added.

## Reproducibility

The [experiment README](../../experiments/workers-connect-d1/README.md) gives setup, test, restart, export/restore, and native baseline commands. Dependencies are recorded in its `Cargo.lock` and `package-lock.json`.

Key tested versions: connectrpc 0.9.1, connectrpc-build 0.9.0, worker/worker-build 0.8.7, Wrangler 4.151.3, workerd 1.20261019.1, Connect TypeScript 2.2.0, protobuf/protoc-gen-es 2.16.0, TypeScript 6.0.3, rustc 1.99.1, Node 26.12.0, protoc 36.1. Wasm packaged in release mode without the optional wasm-opt pass.

Tests ran on Linux aarch64. This is compatibility evidence, not a performance benchmark or measurement of hosted Free-tier CPU usage. Local runtime socket permissions and package downloads required sandbox escalation; those setup constraints are separate from the reproduced application deadline failure.

## Unvalidated and unchanged

- Real Google login, owner provisioning, provider-side MFA, and session security were not implemented. Access checks use the explicitly local synthetic identity.
- Hosted Workers CPU/memory limits, geographic latency, real browser behavior, and server-side cancellation beyond deadline handling were not validated. The deadline failure makes further hosted testing of this stack premature.
- Native Render deployment, Neon Postgres, and a native D1 REST adapter remain untested. The native baseline is only a protocol/runtime comparison, not evidence of those complete architectures.
- B2 encryption/upload, account spending controls, seven-day retention, automated backups, GitHub notifications, and the hourly watchdog are not implemented.
- Production application code, UI wireframes/mockups/prototypes, CI/CD workflows, cloud accounts, payments, and GitHub participation settings remain unchanged.

## Decision frontier

At the end of this experiment, the next decision was the native API/database direction. The owner subsequently accepted native Axum + Render + D1 in Q34; its local HTTP adapter passed [the follow-up experiment](0002-native-axum-d1.md). See [ADR 0003](../adr/0003-native-axum-with-d1.md) for the selected direction and hosted-validation boundaries.
