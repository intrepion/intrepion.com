# MVP 1 operations and launch

Q37 approves the prototype and authorizes separate production implementation. The repository now contains that implementation and CI/CD definitions. The repository is public, with pull requests, issues, discussions, wiki, and automatic merging disabled. Cloudflare provisioning has begun as recorded below; the application is not launched. No application deployment, Google client, domain change, or paid plan has been configured by this work.

## Hosting setup progress

Cloudflare and Render API access checks pass. The owner confirmed Workers Free for this Cloudflare account, no payment method on Render, and no unrelated B2 data with all available B2 billable caps set to zero. These are dashboard confirmations, not an automated audit of provider billing settings.

Created D1 database `intrepion` with a Western North America location hint and applied `0001_initial.sql` using Wrangler's remote migration command. A live REST probe verified the expected tables, response envelope, Unicode text, string-bound integer parameters, and `INSERT RETURNING` acknowledgment. Its synthetic task was deleted and its absence verified. This does not yet verify the hosted Rust API or real authentication.

Created empty direct-upload Pages project `intrepion-life`, with production branch `main`, no Git integration, and no deployment or custom domain. Existing Pages projects were left unchanged. Saved Cloudflare account/database identifiers in the `production` and `operations` GitHub environments, and the Pages project name in `production`. Both environments permit deployment from protected branches only. `OPERATIONS_ENABLED` and `LAUNCH_CHECKS_COMPLETE` remain unset.

Backblaze access and the initial offsite drill pass. Both application keys are restricted to the same single bucket and `daily/` prefix; the backup key supports read/write/delete and the watchdog key is read-only. The API verifies that the bucket is private. Object Lock settings were confirmed in the browser helper; the restricted key cannot read that setting. The event-notification API reports that the feature is not enabled; the helper also records the owner's confirmation that no bucket webhooks are configured. Keys were requested with 90-day lifetimes and need rotation before expiry.

The live drill verified B2 upload, authenticated download, listing, and deletion of a synthetic file version. It then exported real D1 with a synthetic task, encrypted and uploaded the export, downloaded and decrypted the archive locally, restored it into isolated SQLite, and recovered the synthetic task unchanged. The separate read-only watchdog validated the archive and verification marker. The synthetic task was removed from the source database and temporary plaintext files were removed. One small encrypted initial archive and its marker remain offsite. Restored tasks through a hosted API and GitHub workflow/notification delivery remain untested.

The drill found that valid upload URLs use `*.backblaze.com`, while the client had allowed only `*.backblazeb2.com`. The client now accepts both provider domains over HTTPS, still rejects unrelated/lookalike hosts and disallows redirects, and has a regression test for that boundary. A new production age recovery key is stored locally in a private Git-ignored file. The owner copied it to a separate USB drive, and the recovery helper verified that the recovered file's public recipient matches the original key. The four B2 key secrets, bucket ID, and public age recipient are installed in the GitHub `operations` environment; the private age key is not. Ongoing D1 backup credentials are still needed before scheduled operations can be enabled. [CI for the backup fix](https://github.com/intrepion/intrepion.com/actions/runs/39561395842) passed.

Google client and owner setup is the next browser step. A temporary local helper uses Google's official authentication library to verify the sign-in response, its intended audience, issuer, expiry, signature algorithm, and one-time setup nonce. It binds only to loopback, checks the local host/origin, cookie and CSRF header, and requires confirmation of the verified account before saving its stable `sub` privately. Synthetic signed-token tests pass, including rejection cases; no real Google sign-in has been completed yet. This is an operator setup tool, not a production authentication bypass or a deployed application feature.

The selected Render workspace already has an unrelated free web service in Oregon. Leave it unchanged and account for the shared free instance-hour allowance before adding this app. This app has no Render service yet. The local setup token is temporary and must be replaced with purpose-specific ongoing credentials before configuring runtime or workflow secrets. Local setup credentials and generated Wrangler configuration are Git-ignored.

## Local implementation evidence

Verified locally: the release binary and static website build; Rust formatting and Clippy (normal and development-auth builds), ESLint, TypeScript/Astro, Prettier, generated-client reproducibility, and Actionlint pass. Three Rust tests, two client model tests, three backup tests, six real-HTTP/local-D1 integration workflows, and six local browser workflows pass. The browser workflows cover durable task operations, confirmation focus, draft protection, lost-response retries, session expiry, and mobile/plaintext rendering. Local client model coverage is available and was exercised; it is not a whole-application coverage claim. A real age encrypt/decrypt round trip restored the schema successfully in isolated SQLite.

The owner reports that `sudo docker build -f server/Dockerfile -t intrepion-server:local .` succeeded, clearing the local container-build verification blocker. The agent's account still lacks direct Docker socket access; the successful privileged build does not change those permissions. The [first GitHub CI run](https://github.com/intrepion/intrepion.com/actions/runs/39552911244) passed for implementation commit `4f371a2`, including the production container build and generated-client/local-D1 integration tests. Deployment and operational workflows remain disabled pending launch checks. Application deployment, real Google login, GitHub backup/watchdog execution, notification delivery, restored tasks through a hosted API, and automated account-limit verification remain outstanding. Public RSA fixtures used in tests are intentionally non-secret and have no provider access.

## Before enabling cloud workflows

- Verify that the selected Render, Pages, D1, and B2 accounts operate without a payment method or with provider-enforced zero-dollar caps. Do not use trials. Keep the $0 recurring target and $10 hard ceiling; adding any paid service still requires approval.
- Use Render's free Docker web service with repository root context, `server/Dockerfile`, no disk, `/health/live`, and automatic deploys **disabled**. Configure the server environment from `server/.env.example`. The Docker build omits `dev-auth`.
- Create the D1 database and static Pages direct-upload project. Do not enable Pages Git integration or automatic production deployments. Set custom HTTPS web/API domains under the same site so session cookies work reliably. Verify real D1 REST authentication, string parameter behavior, limits, and write acknowledgments.
- Configure a Google web client for the exact web origin. Verify the owner identity's stable `sub` privately and configure it as `GOOGLE_OWNER_SUB`. Test the owner, a different Google account, cancellation, expiry, logout, and Google MFA/recovery. Never authorize by an email address or the OAuth consent screen's test-user list.
- Create a private B2 bucket. Verify no-card operation or zero-dollar caps for every available billable category. Keep billing and security email alerts enabled. Do not configure Event Notifications webhooks on this project's bucket because Class D charges are uncappable; leave unrelated buckets' rules unchanged. Restrict application keys to this bucket and `daily/` prefix; use a separate read/list watchdog key. Rotate expiring keys before their deadline. Keep the age private key offline in independent recovery storage and test its recovery. Only the public age recipient goes into Actions variables.
- Test an offsite upload, download, actual decryption, and restore into an isolated database. Verify a saved task through the API after restoring. Do not restore unreviewed data into the live database. Test alert emails by deliberately failing each workflow, then fix and rerun it. A skipped job is not a successful operational check.

Only after the relevant setup checks pass, set the **repository** variable `OPERATIONS_ENABLED=true`. Run the backup and watchdog manually and verify private failure-email delivery. Set `LAUNCH_CHECKS_COMPLETE=true` only after all launch checks, including backup/restore, owner-only login, spending controls, and repository participation settings, have passed. The two variables deliberately default to disabled; their presence in the code does not certify any provider setting.

## GitHub configuration

The `CI` workflow runs on every push and every pull request targeting `main`, on standard Linux runners. It builds the API and client, checks formatting, Clippy, ESLint, TypeScript/Astro, generated-code drift, unit tests, backup behavior, and generated-client integration tests. E2E and coverage remain local. It needs no cloud secrets and uploads no artifacts or caches.

Configure these variables and secrets in the indicated environments. The two enablement variables above must be repository variables, because job conditions evaluate before environment variables become available.

| Location | Variables | Secrets |
| --- | --- | --- |
| `production` environment | `API_ORIGIN`, `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, `PAGES_PROJECT`, `RENDER_SERVICE_ID` | `D1_MIGRATION_TOKEN`, `PAGES_DEPLOY_TOKEN`, `RENDER_API_KEY` |
| `operations` environment | `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, `B2_BUCKET_ID`, `AGE_RECIPIENT` | `D1_BACKUP_TOKEN`, `B2_BACKUP_KEY_ID`, `B2_BACKUP_KEY`, `B2_WATCHDOG_KEY_ID`, `B2_WATCHDOG_KEY` |

Use the narrowest provider permissions that support each operation. The running API's D1 token belongs only in Render, never in the static client. Configure Actions failure email notifications privately. No workflow creates public issues, comments, or artifacts for alerts.

The repository is public with pull requests, issues, discussions, wiki, and auto-merge disabled. `main` requires the `checks` status from the GitHub Actions app, with up-to-date checks, force pushes and deletion blocked, and the owner's admin bypass retained for direct maintenance. No pull-request review is required while pull requests are disabled. Workflow tokens request only their needed read permissions. The participation document states invitation-only contributions and reserved reuse rights. Public visibility still allows GitHub features such as forks under its platform terms. No open-source license has been added.

Collaborator-only interaction limits are active until **2027-04-21 06:07:23 UTC**. GitHub's [interaction limits](https://docs.github.com/en/communities/moderating-comments-and-conversations/limiting-interactions-in-your-repository) last at most six months; renew the restriction before expiry while this participation policy remains in force. No permanent comment ban is claimed. Invite collaborators individually and enable their contribution paths only when the owner requests it.

## Deployment and rollback

Use **Deploy → Run workflow** on `main` with a full commit SHA. The gate requires the latest push-CI run for that exact `main` revision to have succeeded, then checks that it is an ancestor of current `main`. The workflow checks out that SHA, builds the static client, applies additive D1 migrations, requests the same Render commit, waits for a confirmed live deployment, and uploads the corresponding static assets. Environment approval rules may be added if desired; deployment itself always requires a manual workflow trigger.

For initial provisioning, Render may attempt a first deployment; keep the service unexposed or suspended until the launch checks pass. Disable auto-deploys explicitly: choosing a commit through Render's API does not disable them. Inspect provider dashboards if a deployment times out before retrying. Partial deployment can leave a new API with the previous web client, so maintain backward-compatible RPC/schema changes. A rollback uses another passing revision; it does not automatically reverse migrations or restore deleted tasks. There are no destructive down migrations in this MVP.

## Backup and recovery

Daily backup runs at 04:17 UTC. It exports D1 privately, restores the SQL into isolated in-memory SQLite for integrity/schema checks, encrypts with age, uploads to B2, downloads and hashes the encrypted archive, then writes and reads back a verification marker. Only after those checks does it prune versions under its exact daily backup paths older than the current UTC day plus six prior days. It never stores plaintext exports as GitHub artifacts. A 20 MiB export ceiling forces a storage-budget review before larger backups are accepted.

The separate watchdog runs hourly at minute 43. It fails when no verified marker exists, the recorded snapshot is older than 24 hours or invalid, provider access fails, or the referenced archive's metadata does not match. The watchdog has no D1 credential and cannot write or prune backups. Configure bucket retention and audit historical versions as an additional precaution, using settings consistent with seven daily backups. Do not apply object lock that prevents the agreed expiration policy.

Daily checks establish that plaintext SQL restores and uploaded ciphertext matches. They do not decrypt on GitHub: the private age key stays offline. Before launch and after backup-process changes, download an archive privately and run:

```sh
umask 077
age -d -i /private/path/recovery.age-key -o /private/path/restore.sql /private/path/database.sql.age
node scripts/backups.mjs verify-sql /private/path/restore.sql
```

Restore into a new isolated local or D1 database, delete restored sessions and login challenges, and verify task operations before changing the running service's database ID. Deleting sessions prevents recovery from reviving old sessions. Keep credentials and plaintext out of logs and version control; remove temporary exports after the drill. Do not overwrite the live database without an explicit recovery decision.

The recovery objectives remain 24-hour data loss and restoration within one day, as best-effort targets. Native GitHub emails only report jobs that actually execute. Shared scheduler delays, disabled schedules, or a GitHub outage can prevent both jobs and their alerts; this is the accepted MVP blind spot. No Sentry or external heartbeat monitor is included.

## Measurements and migration review

Keep a private monthly ledger of actual/forecast cost and provider usage against current free allowances. Review it at least weekly during launch. Record D1 rows read/written and storage from Cloudflare, Render instance hours and availability/cold starts, Pages usage, B2 storage/transactions, and Actions/storage use. Provider quotas and spending caps must be rechecked during account setup and whenever plans change; an estimated allowance is not an enforced cap.

Export sanitized JSON application logs privately and run `node scripts/metrics.mjs < /private/path/server.jsonl` for request counts, API p95 and server-error rates. Exclude startup periods from the input when assessing warm p95. The application logs no task contents, identities, cookies, tokens, raw URLs, SQL, or provider response bodies. `node scripts/probe.mjs https://api.intrepion.com` records a content-free process-availability and first-response-time sample; after at least 15 idle minutes it can measure Render wake-up delay. It does not establish D1 availability or continuous uptime. Collect real owner task-RPC samples for database-inclusive latency.

Investigate forecast cost above $8/month, any allowance at 80%, warm API p95 above 500 ms, server errors above 1% with meaningful request counts, or backup age above 24 hours. Small samples are labeled in metric output. These thresholds prompt investigation and a migration/spending decision; they never automatically buy services or migrate data.

Implementation references: [Google ID-token verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), [Google SDK JavaScript API](https://developers.google.com/identity/gsi/web/reference/js-reference), [Render commit deployment API](https://api-docs.render.com/reference/create-deploy), [Pages CI direct upload](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/), [B2 authorization](https://www.backblaze.com/apidocs/b2-authorize-account), [B2 file versions](https://www.backblaze.com/apidocs/b2-list-file-versions), and [B2 lifecycle rules](https://www.backblaze.com/docs/cloud-storage-lifecycle-rules). Provider-side behavior still needs a live launch rehearsal.
