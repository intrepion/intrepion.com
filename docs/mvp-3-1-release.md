# MVP 3.1 release and recovery procedure

Status: implementation and local verification are in progress. This document does not authorize a deployment, real email, DNS changes, AWS resources or credentials. Finish the fixed-baseline code review before preparing the live cutover.

## Local review

Use the repository's pinned toolchains and existing build prerequisites. Run `npm run dev:normal` and open <http://127.0.0.1:4322>. The fake mailbox is <http://127.0.0.1:8793/mailbox>. Use an `@example.invalid` address when inviting a fake Google identity; this provider cannot send real email.

This command uses a separate persistent `.wrangler/normal-development` database and journal. First use seeds illustrative local safety values; subsequent starts preserve its settings and growth pause. The mailbox is temporary, so use explicit Send again after restarting if its fake email was lost. Stop the command with Ctrl+C to release its local ports. The default `npm run dev` retains its earlier development database.

The approved standalone prototype remains separate on `prototype/mvp-3-1-invitations`. Its model and HTML are not production code.

## Release gates

1. Require the complete Rust, generated-client/local-D1, encrypted-recovery, lint, formatting, type, unit and build checks. Browser E2E and coverage remain local only. The CI integration job also exercises an actual local D1 export through encryption and independent-journal recovery.
2. Commit implementation, then complete Standards and Spec reviews against `b4b5589` and `docs/mvp-3-1-plan.md`. Resolve findings and require passing CI for the exact proposed main commit.
3. Measure retained production data and an isolated upgraded recovery export. Propose finite personal/household review and hard thresholds, collection-item/section bounds and recovery headroom for owner approval. Prototype and local-fixture values are not launch settings.
4. Prepare the selected AWS SES setup below, its ongoing costs and narrowly scoped credentials for review. Collect the actual sender and monitored reply/support mailbox privately. Do not assume introductory credits or trials.
5. Take and verify a fresh encrypted backup using the existing narrow backup/reader keys and complete independent journal. Keep the approved spending and export-size alerts in place.
6. Execute the stopped-service cutover only after the owner approves the concrete settings and proposed release.

## Provider readiness

- Select one supported commercial AWS region and SES à-la-carte sending. Obtain production sending access for the intended invitation recipients before launching normal invitations; a provider sandbox recipient list is not product registration.
- Verify a sending subdomain and its provider-supplied DNS records. Preserve the existing root MX/inbox routing and unrelated DNS. Check the chosen sender, DKIM alignment and monitored Reply-To address with actual delivery tests at the setup gate.
- Create the configuration set and exact regional SNS feedback topic for delivery, permanent-bounce, complaint, rejection, rendering-failure and delivery-delay notifications. Do not enable open/click tracking for this feature.
- Configure SNS signature version 2, explicit bounded HTTP delivery retries and a subscription SQS dead-letter queue. Review cold-start recovery, queue monitoring and safe redrive against current provider documentation before enabling sending. Feedback must reach `https://api.intrepion.com/email/feedback`; arbitrary certificate/confirmation URLs are rejected.
- Restrict topic publication to the intended SES source/account and make the dead-letter queue policy subscription-specific. Verify IAM/resource-policy syntax and actual grants during setup. The sender needs only the intended SES sending capability; it must not receive SNS administration, account-wide administrator or backup permissions.
- The verifier trusts signing keys distributed by the exact regional SNS HTTPS endpoint with ordinary TLS validation, certificate dates and RSA/SHA-256 message verification. This is not independent PKI path validation of the downloaded signing certificate. See the [provider contracts and trust decision](research/mvp-3-1-sns-contracts.md).
- Verify intentional delivery, permanent bounce and complaint handling, duplicate callbacks and suppression review before enabling the operations schedule. Some providers do not report complaints; a submitted message is not proof of delivery.

Configure the SES settings as a group: `SES_REGION`, `SES_FROM_ADDRESS`, `SES_REPLY_TO_ADDRESS`, `SES_CONFIGURATION_SET`, `SES_FEEDBACK_TOPIC_ARN`, `SES_ACCESS_KEY_ID` and `SES_SECRET_ACCESS_KEY`. Temporary credentials may also use `SES_SESSION_TOKEN`. Store them only as private runtime secrets. Independently generate `INVITATION_SIGNING_KEY` and the separate `EMAIL_OPERATIONS_TOKEN`; neither belongs in the browser or Git. Preserve the signing key with the existing private recovery material; changing it requires reviewing/replacing pending invitation generations.

## Controlled cutover

1. Reconfirm the exact source commit, passing checks, backup recovery, existing owner Google identity, provider readiness and approved launch values. Review and explicitly revoke any remaining pending legacy invitations; policy activation refuses them.
2. Freeze customer writes and quiesce the old API. Verify transactional guards are empty. Apply migrations 0015–0024 under the stopped-service procedure. The migrations preserve existing accounts, personal/shared content, History, attribution and historical allocations; they leave independent policy disabled and growth paused.
3. Deploy the reviewed production binary with customer writes still frozen. Verify `/auth/config` reports schema version 4 and the production development-login route is absent. Confirm the current schema, integrity and writer fences before uploading the matching web client.
4. Keep growth paused while unfreezing the new API for existing accounts. The owner can now use Google sign-in and the Admin UI to preview and explicitly apply the approved independent safety values. Reload the client and verify normal name-only household management, retained content and hidden ordinary-user limits. Historical allocations remain in storage, without reserving normal-account capacity.
5. Install the reviewed SES/signing/operations secrets with growth still paused. Confirm the configured topic, feedback intake, delivery/suppression checks and current owner access. Confirm the support link reaches the monitored mailbox.
6. Install the separate operations secret in GitHub's `operations` environment. Keep `EMAIL_OPERATIONS_ENABLED` unset/false until the controlled failure-notification test has been received and real readiness checks pass. The hourly job processes the bounded queue before alerting at 80% of the monthly application attempt ceiling. Existing backup, watchdog and household-maintenance schedules retain their separate credentials.
7. The owner explicitly resumes growth, then performs a fresh-browser recipient invitation/Google-match/acceptance check and verifies shared versus personal isolation. Ask the owner to initiate any real invitation emails. Verify data after reload, equal-head authority, rejection of an unrelated Google account, and that ordinary heads have no Admin entry.
8. Capture sanitized deployment/check evidence, verify a new encrypted backup and update the private recovery record. Normal deployment preflight requires the current schema; the workflow rejects source revisions predating migration 0024. Use compatible forward fixes after this transition.

## Measurements and recovery rules

Logical space storage counts UTF-8 content/History and retained household administrative, membership/allocation JSON and invitation payloads. Identifier, index, physical and site-wide operational overhead are excluded. Actual SQL export size and provider physical/daily usage remain separate measurements. Anonymous daily aggregate samples are retained for 30 days; growth requires a comparable sample at least one day old and no older than seven days. Different accounting modes are not compared, and recovery clears stale samples.

Invitation creation/replacement and acceptance are checked transactionally against increasing retained space usage. Existing over-limit content is retained. Revocation and loss of access must remain available when full. The closing head's household slot remains counted until protected erasure; closure is final, with the previously approved UTC calendar-month-end deadline.

Every recovery uses a new isolated database, the complete independent journal and the current recovery tool. It preserves later account bans/head removals, protected erasures, known public identity bindings and newer pending snapshot restrictions. It clears authentication/onboarding sessions, revokes pending links, cancels queued mail and pauses growth. Verify account/membership metadata and retained-content counts before reconnecting an API.

A backup can omit attempts handed off after capture. Recovery therefore holds the current UTC month's application send counter at least at 10,000 and labels it `recovery_hold`; it is not a measured send count or AWS invoice cap. Resuming growth does not clear the hold. The next UTC month has a new allowance. Any earlier counter correction requires a separate private owner review of complete attempt evidence; routine restore must not silently lower it.

If a protected identity is newer than the profile snapshot, preserve its known public ID. An ordinary fresh invitation cannot bypass a protected ban. For a missing suspended profile, privately verify the person's Google subject, reconstruct the profile with access disabled through the existing operator recovery tool, then explicitly restore access in Admin. Keep raw subjects and proof tokens out of chat, Git and routine logs. Conflicting identity/protection records require investigation before reconnecting the restored database.

Detailed email logs/callback receipts expire after 30 days and site-admin audit after one year. Current blocks and minimal replay protection outlive log expiry. Household erasure also removes its invitation and delivery metadata; mail suppression is an independent current restriction. Follow the existing encrypted-backup retention and independently protected erasure rules.
