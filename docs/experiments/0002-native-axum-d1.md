# Native Axum + D1 HTTP: local feasibility results

Run on 2026-10-20 after the owner accepted the native Render + D1 candidate in Q34. [Source and reproduction commands](../../experiments/native-axum-d1/README.md).

## Outcome

Native Rust/Axum with an HTTP D1 adapter passes the local feasibility gate. All eight shared generated-client integration tests pass, including both deadline cases that failed on Workers. The local architecture does not require Postgres, a Cloudflare account, a Wasm build, or a deployed bridge service.

| Check | Result |
| --- | --- |
| Generated client, JSON and protobuf | Passed |
| Missing/non-owner identities and invalid task errors | Passed with synthetic identities |
| D1 create/list/edit/complete/reopen/delete, duplicate and missing IDs | Passed through native HTTP adapter and local D1 bridge |
| Client deadline and server-enforced deadline | Both passed |
| Local browser-origin permission and preflight | Passed from Node; no full browser E2E run |
| HTTP adapter request/parameter/auth envelope | Passed against local fixture server |
| Ten defensive malformed/error/status fixtures | Passed in a parameterized Rust test |
| Synthetic task survives stopping/restarting API and bridge | Passed |
| Export/restore into separate local D1 storage | Passed |
| Stopped bridge produces sanitized Connect unavailable error | Passed |
| Native binary without explicit local-mode opt-in | Refused startup as intended |
| Rustfmt, Clippy with warnings denied, TypeScript typecheck | Passed |

Two Rust test functions plus eight shared integration tests pass. Recovery, persistence, disconnected-upstream, and startup-refusal checks are separate probes. No deadline tests were disabled or redefined to accept the prior failure.

## Adapter boundary

The Rust adapter uses a reusable reqwest client with connection/request timeouts and redirects disabled. It sends the server-side bearer token plus `{sql, params}`, rejects unsuccessful HTTP responses, API-envelope errors, statement errors, and malformed or unexpectedly batched results. It does not forward provider messages, SQL, parameters, URLs, or tokens into client-facing error messages. HTTP 429/5xx and transport failures become a retryable-looking `unavailable` RPC error, but the application does not automatically replay a write.

Task mutations use one atomic SQL statement and `RETURNING`; creation uses `ON CONFLICT DO NOTHING` rather than a check-then-insert race. The local D1 bridge accepts string parameters only, avoiding the broader type support of Worker bindings that the REST schema does not promise. These choices validate a deliberately small REST subset; the code remains an experiment rather than the production data-access layer.

The error fixtures are defensive parser tests. They are not observations that Cloudflare actually returns every tested HTTP-200 failure combination. The bridge wraps D1 binding results in the REST envelope and is not the real Cloudflare REST gateway.

Sources: [D1 query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/), [D1 binding statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/), [D1 local development](https://developers.cloudflare.com/d1/best-practices/local-development/), [Cloudflare API limits](https://developers.cloudflare.com/fundamentals/api/reference/limits/).

## Remaining hosted evidence

Before launch, verify Cloudflare REST token scope, acceptance of bound string parameters in the live schema, hosted migrations/export, rate-limit handling, Render-to-D1 latency, cold starts, provider quotas, and no-overage account configuration. Real Google OAuth/session security, B2 backups, spending controls, GitHub watchdog/email delivery, production CI/CD, and application UI remain separate work.

This experiment neither creates nor deploys cloud resources. Its native binary hardcodes the loopback D1 bridge and synthetic credentials and requires explicit local opt-in. Production must use a separate secure configuration and authentication implementation after the design gates.

## Reproducibility

Native dependencies are locked in this experiment's `Cargo.lock`; TypeScript client/CLI tools reuse the first experiment's `package-lock.json`. Added native versions include reqwest 0.12.28 and tower-http 0.6.11. Rustc 1.99.1, Node 26.12.0, protoc 36.1, Wrangler 4.151.3, Connect Rust 0.9.1, and Connect TypeScript 2.2.0 match the documented local environment.

Local test timing is not a hosted performance benchmark. The eight shared tests use the same schema and client as the Workers experiment; the only shared test adjustment accepts standard CORS preflight status variations while still requiring the correct allow-origin behavior.
