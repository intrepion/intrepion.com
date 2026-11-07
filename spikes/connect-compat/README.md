# ConnectRPC compatibility spike

A disposable, unauthenticated transport experiment for the restart worktree.
One shared protobuf method connects the official **connectrpc/connect-rust**
runtime on Axum to generated client types. No accounts, family data, database,
authentication, secrets, deployment, or production configuration are involved.
Use dummy platform labels only.

## Result (2026-11-07, Linux and macOS)

| Client or check | Result | Limit |
| --- | --- | --- |
| Rust generated client / CLI | PASS: binary and JSON round trips; typed validation errors | Linux CLI and macOS generated-client tests; no desktop GUI or Windows verification |
| Official Connect web SDK | PASS: 8 live tests on Linux and macOS | Node integration suite, supplemented by Chrome below |
| Chrome browser | PASS: binary/JSON calls, typed errors, retries, repeated submits, reload and post-reload call | Tested on macOS; other browsers not tested |
| Browser CORS | PASS: real Chrome cross-origin requests plus explicit allowed/rejected-origin tests | Local development origins only |
| Web build | PASS: local generation, TypeScript, esbuild | Tested on Linux and macOS |
| Kotlin Android | PASS: local code generation, APK build, real API35 arm64 emulator SDK calls and typed error | Dedicated AOSP emulator; no physical device or production app verification |
| Swift SDK on macOS | PASS: official local generation, build and CLI runtime; greeting, server identity and typed error | Connect binary Protobuf; this does not prove iOS execution |
| Swift iOS Simulator | PASS: arm64 IOSSIMULATOR build and actual iOS18.4 execution; greeting, server identity and typed error | Headless SDK probe, not GUI app lifecycle or physical device |

The real-browser check ran on the Mac after Linux browser automation was
unavailable. The Swift package also ran on macOS using its existing Swift 6.4.2
and Xcode 27.2 toolchain; no Swift installation was needed. After approval,
Xcode first-launch setup completed using its already accepted license. The
iOS-target build passed. The first simulator launch stalled and was stopped;
a user-requested retry after reducing background apps passed on iOS18.4.
See the [iOS simulator report](ios/IOS_SIMULATOR_CHECK.md). Android also passed
a real APK run after installation of the approved official SDK components.

This establishes the small shared unary RPC across the planned client SDKs.
The Android app and Swift probe are disposable checks, **not production mobile
apps**. No full framework conformance, gRPC, streaming, TLS, authentication,
physical-device or iOS GUI lifecycle tests were attempted.

## Reproduce the verified portion

Prerequisites: Rust 1.88+ with rustfmt and clippy, Node 22.6+, npm,
Python 3.8+, and protoc
(tested with Rust 1.99.1, Node 26.12.1, npm 11.20.0, protoc 36.1).
From this directory:

```sh
(cd web && npm ci --ignore-scripts --cache .npm-cache)
./scripts/check.sh
```

The check runs formatting, Clippy with warnings denied, three Rust integration
tests, Rust binary builds, reproducible web code generation, TypeScript, the web
bundle, the Rust CLI, eight live web SDK tests and eleven offline Android-runner
tests. It starts its own Axum service on `127.0.0.1:4100`, then stops it,
including on failure. Ports 4100, 5038, 5580 and 5581 must be free; the latter
three are used only by synthetic runner tests, never a real SDK or emulator.
After dependencies have been fetched, `CARGO_NET_OFFLINE=true ./scripts/check.sh`
works without contacting the Cargo registry. No toolchain is installed by the
check script.

For an interactive web check, use two terminals from this directory:

```sh
# Terminal 1
cargo run --locked --manifest-path rust/Cargo.toml --bin server
# Terminal 2
cd web && npm run dev
```

Open <http://127.0.0.1:5173>, try both wire formats, submit a blank label, then a
valid label after the error. Ctrl-C stops each development process. In isolated
command environments, start service and client in the same execution context,
as the check script does. The service intentionally cannot bind a LAN interface.

## Contract and layout

- `proto/spike/v1/compatibility.proto`: single source for all clients.
- `rust/`: generated runtime/service/client via `connectrpc-build` and `protoc`;
  Axum adapter, loopback service, CLI and integration tests.
- `web/`: checked-in locally generated Protobuf-ES descriptor, official
  Connect web transport, small UI, Node integration tests.
- `android/`, `ios/`: official-SDK integration samples, local generator steps,
  precise remaining requirements and simulator/emulator networking instructions.
  The Swift package includes a repeatable macOS CLI compatibility check.
- `scripts/check.sh`: repeatable checks for the verified subset.

`POST /spike.v1.CompatibilityService/Ping` accepts `client_name`. Its trimmed
length must be 1–64 UTF-8 bytes. It returns `message: "Hello, <label>!"` and
`server: "connect-rust/axum"`; invalid input returns Connect `invalid_argument`.
Protobuf JSON spells the request field `clientName`.

Only `http://127.0.0.1:5173` and `http://localhost:5173` receive CORS approval.
CORS is a browser constraint, not authentication. Never put real data into this
service or expose it publicly. HTTP is intentional only for loopback development;
this is not a production transport or security design.

## Versions and sources

The pinned, tested Rust runtime is `connectrpc 0.9.1`, with
`connectrpc-build 0.9.0`, `buffa 0.9.2`, and Axum `0.8.9`. Cargo.lock captures
transitive versions. It is the official `connectrpc/connect-rust` implementation,
not a similarly named unofficial crate. Its pre-1.0 APIs may change. In this
version generated client responses use `response.view()` or `into_owned()`;
direct field access on the response wrapper does not compile.

Web uses `@connectrpc/connect` and `@connectrpc/connect-web 2.2.0` with
Protobuf-ES `2.16.0`. npm lockfile records resolved packages. Native samples pin
Connect-Kotlin `0.10.0` and Connect-Swift `1.2.3`; their READMEs give inspected
upstream source URLs, the verified macOS path, and remaining mobile limitations.

Sources consulted:

- [Official Connect Rust repository and current quick start](https://github.com/connectrpc/connect-rust)
- The locally installed official crate README, generated code and runtime source
  for the exact pinned `connectrpc 0.9.1` / `connectrpc-build 0.9.0` versions.
- [Official Connect web repository](https://github.com/connectrpc/connect-es)
- [Official Protobuf-ES repository](https://github.com/bufbuild/protobuf-es)
- [Official Connect Kotlin repository](https://github.com/connectrpc/connect-kotlin)
- [Official Connect Swift repository](https://github.com/connectrpc/connect-swift)

This pins the versions tested here, not a claim that every version is the newest
release. Generated sources remain local; no schema was uploaded for generation.
