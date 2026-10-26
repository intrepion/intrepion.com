# Astro Everyday lists client

MVP 3.1 normal-account review uses `npm run dev:normal` from the repository root, then <http://127.0.0.1:4322>. The fake mailbox is <http://127.0.0.1:8793/mailbox>; only `@example.invalid` recipients work locally. Normal accounts use name-only household creation and emailed onboarding; only the site owner sees Admin. The ordinary capacity/allocation controls described for legacy MVP 3 below disappear in this mode. Run `NORMAL_ACCOUNTS_TEST=1 npm --prefix web run test:e2e` separately from the default legacy suite and development stack.

This static Astro/TypeScript client independently implements the approved MVP 1, MVP 2 and MVP 3 prototype interactions. It imports no prototype application code. It uses generated ConnectRPC clients and real server acknowledgments; lists, tasks, drafts and credentials are never persisted in browser storage.

After `npm ci` and `npm --prefix web ci` at the repository root, run `npm run dev` there to start the complete development stack, then open <http://127.0.0.1:4322>. The Owner and Morgan development buttons appear only when the local server advertises development mode. Production renders Google's official SDK button.

For a production static build, set `PUBLIC_API_ORIGIN` to the HTTPS API origin and run `npm --prefix web run build`. The fallback `http://127.0.0.1:8788` is for local builds. The deployment workflow requires an explicit origin. The API owns Google credentials, authorization, CSRF validation, sessions, and persistence; a public client ID is not a secret.

The client preserves draft text through failures and session expiry. It shows only confirmed writes, offers a safe retry, and rejects stale multi-window edits. Everyday lists provide **Review latest** with the newer saved values beside the preserved draft before an explicit save. Existing task editing retains **Reload list** and discard confirmation. Reloading the browser loses an unsaved in-memory draft and triggers a browser leave warning. No offline editing is included.

```sh
npm --prefix web run check
npm --prefix web run test:unit
npm --prefix web run build
npm --prefix web run test:e2e
npm --prefix web run coverage
```

E2E and coverage are local-only. Stop the development stack before E2E: it starts an isolated D1 database, real Rust API, independent loopback ledger, and static preview on ports 8791, 8788, 8792 and 4322. `CHROMIUM_PATH` overrides the default `/usr/local/bin/chromium`. E2E refuses to run with `CI` set. Run web builds sequentially with E2E: rebuilding `web/dist` while the suite serves it can temporarily remove routes. Traces are local and ignored by Git; never upload traces containing real task data. Coverage currently measures the client field-validation and ordering module; server coverage can be collected locally using `cargo llvm-cov --workspace --html` after installing that tool. Neither coverage command is in CI.

No theme selector or later-client features are included in MVP 1. The original standalone `/prototype` remains runnable on port 4321 and separate from this application.

MVP 2 adds Shopping, checklist templates and independent runs, section/item ordering, History, Archive, and Trash. Permanent erasure has a separate scope confirmation and a retry identity recoverable after a reload. The [release and recovery guide](../docs/mvp-2-release.md) separates local proof from hosted readiness.

MVP 3 adds a private/shared space selector, household heads/invitations, own count ceilings, personal plan/reallocation previews, independent personal-to-household copies and final closure. Administrative History reports actual actors and changes. Removed household access clears its cached content and drafts; signing in as another identity cannot restore the previous person's draft. Unknown writes keep stable retry identities and prevent an accidental space switch. Full-storage recovery offers explicitly scoped active-content erasure and resumes protected erasure after reload.
