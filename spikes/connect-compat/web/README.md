# Web client compatibility probe

This deliberately small UI and test suite share the official `@connectrpc/connect-web` transport and a locally generated Protobuf-ES service descriptor. The only RPC is a dummy `Ping`; it does not implement authentication, accounts, or persistence.

## Run

Prerequisites: Node.js 22.6 or newer, npm, and `protoc` on PATH. Start the sibling Rust service on `127.0.0.1:4100`, then:

```sh
npm ci --ignore-scripts --cache .npm-cache
npm run generate
npm run typecheck
npm run build
npm run test:integration
npm run dev
```

Open <http://127.0.0.1:5173>. Try both wire formats, an empty name, and a valid name after an error. Blank input is deliberately allowed through the form to exercise service-side validation. The button disables during a request and becomes available after success or failure.

Generation uses the checked-in shared `../proto/spike/v1/compatibility.proto` and a project-local plugin. It does not upload the schema to a remote code-generation service. The generated TypeScript is checked in, with its trailing whitespace normalized
by the generation script. `npm run generate` requires `protoc` but normal build/test runs do not.

## What tests prove

- The same browser transport runs in Node against the Rust service using binary and JSON encodings.
- Generated request/response types decode the expected message and server identity.
- The service trims names and maps empty/whitespace names to the typed `InvalidArgument` error.
- The service accepts CORS preflights for the two configured local web origins and the required request headers.

Node does not enforce browser CORS. A separate real Chrome check on the Mac passed binary/JSON calls, typed errors, retries, repeated submits, reload and browser-enforced cross-origin requests on 2026-11-07. The Node preflight assertions alone are not a substitute for that browser check. The development server binds only to loopback. It copies `index.html` when starting; restart it after editing that file.
