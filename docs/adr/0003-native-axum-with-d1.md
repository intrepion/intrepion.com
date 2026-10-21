# Use native Axum with D1 for the first MVP

Use a native Rust/Axum API on Render, Cloudflare D1 through its HTTP query API, and an Astro static client on Cloudflare Pages. The owner accepted this direction in Q34; local experiments passed task operations, persistence/recovery, and deadline handling, while the Workers Rust/ConnectRPC stack panicked on deadlines.

This accepts Render's cold starts and a Cloudflare-specific database adapter to preserve recurring-free operation and avoid an additional Postgres provider. Keep D1 behind a narrow server-side boundary; production credentials, live REST behavior, latency, quotas, and spending controls must still pass hosted checks before launch. The local D1 HTTP bridge is development tooling and is not deployed.
