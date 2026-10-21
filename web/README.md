# Astro task client

This static Astro/TypeScript client independently implements the prototype interactions approved in Q37. It imports no prototype application code. It uses generated ConnectRPC clients and real server acknowledgments; tasks and credentials are never persisted in browser storage.

After `npm ci` and `npm --prefix web ci` at the repository root, run `npm run dev` there to start the complete development stack, then open <http://127.0.0.1:4322>. The visible development-owner button appears only when the local server advertises development mode. Production renders Google's official SDK button.

For a production static build, set `PUBLIC_API_ORIGIN` to the HTTPS API origin and run `npm --prefix web run build`. The fallback `http://127.0.0.1:8788` is for local builds. The deployment workflow requires an explicit origin. The API owns Google credentials, authorization, CSRF validation, sessions, and persistence; a public client ID is not a secret.

The client preserves draft text through failures and session expiry. It shows only confirmed writes, offers a safe retry, and rejects stale multi-window edits. Reconcile a conflict by copying any draft text you want to keep, selecting **Reload list**, confirming discard, and reopening the saved task. Reloading the browser loses an unsaved in-memory draft and triggers a browser leave warning. No offline editing is included.

```sh
npm --prefix web run check
npm --prefix web run test:unit
npm --prefix web run build
npm --prefix web run test:e2e
npm --prefix web run coverage
```

E2E and coverage are local-only. Stop the development stack before E2E: it starts an isolated D1 database, real Rust API and static preview on ports 8791, 8788 and 4322. `CHROMIUM_PATH` overrides the default `/usr/local/bin/chromium`. E2E refuses to run with `CI` set. Traces are local and ignored by Git; never upload traces containing real task data. Coverage currently measures the client field-validation and ordering module; server coverage can be collected locally using `cargo llvm-cov --workspace --html` after installing that tool. Neither coverage command is in CI.

No theme selector or later-client features are included in MVP 1. The original standalone `/prototype` remains runnable on port 4321 and separate from this application.
