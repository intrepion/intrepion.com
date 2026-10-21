# MVP planning decisions

The owner confirmed shared understanding of this plan in Q33 and authorized the next feasibility milestone. Hosting and database selection remain dependent on experiment results; visual design and production implementation retain the review gates below.

## Confirmed

- The first release serves the owner alone. Public registration is deferred, with a path to multiple users later.
- Target recurring cost is $0 with a $10/month hard ceiling, excluding the existing domain. Adding a paid service requires the owner's approval. Free trial periods and temporary credits do not count toward affordability.
- Launch a native Rust/Axum server in `/server` and a responsive Astro/TypeScript static web client in `/web` first.
- Preserve the intended monorepo direction: later Android/Kotlin in `/android`, iOS/Swift in `/ios`, Rust CLI in `/cli`, and Rust desktop in `/desktop`. Ratatui and Slint remain candidates. Functional implementations of these clients are deferred.
- Initial task operations are create, list, edit, complete, reopen, and delete. A task has a title and optional notes. Data survives logout and server restarts.
- Projects, subtasks, deadlines, reminders, recurrence, attachments, sharing, and calendar integration are deferred.
- AI agents belong to a later MVP. No authority model for future agents has been decided.
- Themes are an idea for a later MVP, suggested with Q36. MVP 1 uses the approved light visual design; no theme picker or alternate themes are included.
- Wireframes, mockups, and prototypes are mandatory for new or substantially changed user-facing workflows. Smaller fixes and backend changes receive proportionate review.
- A separate prototype version of the website must run locally without the Rust server. Prototype code must not become production code.
- The repository is publicly inspectable, with reuse rights reserved, contributions by invitation, and private support conversations. Do not add an open-source license without an explicit decision.
- MVP 1 uses Google login only and restricts access to the owner's account. Other login methods are deferred.
- Occasional downtime, maintenance interruptions, and slow first requests are acceptable to enable recurring free hosting; measure interruptions to inform later spending.
- Recovery targets are 24 hours of lost changes and restoration within one day. The owner accepts the 24-hour target as an operational target with monitoring and alerts rather than a guaranteed maximum. Require daily automated backups stored separately from the running application and a tested restore procedure within the budget.
- Production requires an internet connection. A change is shown as saved only after server confirmation. Offline editing and synchronization are deferred.
- `/prototype` is an interactive website with synthetic tasks, simulated success/error/loading states, and a reset control. It runs with one local command without the Rust server or real login credentials.
- The owner explicitly approves wireframes, then mockups, then the interactive prototype before production implementation. Minor corrections within an approved workflow do not restart all stages.
- Validate ConnectRPC with a small Rust-server/TypeScript-client round trip covering authentication and error handling before committing to the protocol. This feasibility experiment is separate from the website design prototype.
- CI runs on all pushes and on pull requests targeting `main`.
- Production deployment requires a manual GitHub Actions trigger and may deploy only a revision whose required CI checks passed.
- MVP 1 relies on Google for second-factor protection and account recovery. No application-specific second factor or recovery flow is included. Restrict access to the approved Google identity and document an operator procedure for changing it.
- Task titles reject whitespace-only input and allow up to 200 characters. Optional notes are plain text, up to 10,000 characters. Sort incomplete tasks before complete tasks, newest first within each state. Rich text, manual ordering, search, and filtering are deferred.
- Deletion requires confirmation and permanently removes the task from the live application. No trash or undo is included. Backup copies expire under the retention policy; restoring them is an operator recovery operation.
- Retain seven daily encrypted backups, alert on backup failures, and test restoration before launch and after backup-process changes. Monitor backup age against the 24-hour recovery target.
- Measure monthly cost, provider allowance usage, warm API response time, cold-start delay, server errors, availability, and backup age. Exclude task contents and authentication secrets from telemetry.
- Investigate projected spending above $8/month, provider usage at 80%, warm API p95 above 500 ms, server errors above 1% interpreted with request counts, and backup age above 24 hours. These trigger review, not automatic migration or spending.
- Coverage and end-to-end tests remain local-only until the owner explicitly changes the policy, even when public-repository runners could execute them free. Document reproducible local commands.
- Use Render for the native API, D1 through its HTTP API for persistence, and Cloudflare Pages for the static website. The owner accepted this direction in Q34 and the local feasibility check passed. Roughly one-minute API cold starts and separate provider accounts are accepted. Live credentials, REST behavior, latency, quotas, and spending controls still require hosted validation before launch.
- Require provider-enforced spending caps or operation without a payment method; prefer suspension over unexpected charges. Metered services with free allowances alone do not satisfy this policy. Backblaze B2 is selected as the backup candidate, conditional on verifying no-card operation and enforceable zero-dollar spending controls during setup.
- Monitor backup age independently of the backup job. Daily scheduling alone is not a guarantee of the recovery target.
- Send operational alerts to private email using provider and GitHub notifications where possible. No SMS or custom notification interface is included in MVP 1.
- The three-way assessment considered Render + Neon, Render + D1, and Rust Workers + D1. Workers failed deadline compatibility; native Axum + a local D1 HTTP bridge passed the same acceptance checks. See [the architecture decision](adr/0003-native-axum-with-d1.md).
- Technical experiments are isolated from the design prototype and production code. They cover generated-client interoperability, synthetic authentication checks, structured errors, persistence, and export/restore. Local evidence is distinct from real Google login or hosted-limit validation; no custom RPC protocol is authorized.
- Everyday development and integration tests run without cloud accounts, using the selected database's local tooling and a development-only simulated owner login. Test real Google login separately; simulated login must be unavailable in production. The standalone prototype remains server-free.
- Use Astro with TypeScript and static output in both `/web` and `/prototype`, with separate application code. The production Rust API owns authentication and data; the prototype uses synthetic data. Select additional UI libraries only when approved designs show a need.
- Use GitHub Actions alone for backup execution and monitoring in MVP 1: daily verified encrypted backups, a separate hourly backup-age watchdog, and tested native failure-email notifications. The watchdog fails when the latest verified backup is missing, older than 24 hours, or cannot be checked.
- The owner accepts the shared-scheduler blind spot: if both GitHub schedules stop running, neither workflow can generate a failure email. Do not add Healthchecks.io, Sentry, or Cronitor for MVP 1 backup monitoring. An external heartbeat monitor can be reconsidered later.

## Original requirements awaiting detailed design

- ConnectRPC API; verify protocol support across the intended clients before committing to an implementation.
- GitHub Actions builds, unit tests, integration tests, lint, type checks, and format checks. Coverage and end-to-end tests run locally only, per owner preference; this is not an inherent GitHub paid-plan requirement for a public repository using standard runners.
- Desired eventual authentication options: Microsoft, Facebook, GitHub, Apple when affordable, email magic links, SMS one-time codes, second-factor codes, and email/password, in addition to initial Google login. Account linking, recovery, and second-factor policy remain unresolved.
- Measurement implementation, sampling windows, and notification delivery for the agreed review triggers.
- Production D1 configuration, hosted REST validation, backup implementation, and measurable availability expectations. Local development uses native Axum and a loopback HTTP bridge to Wrangler's local D1; Postgres is not required, and the bridge is not deployed.
- Local validation commands and any additional UI libraries.
- GitHub configuration that implements the agreed participation policy, plus exact licensing terms.

## Feasibility evidence

The first [Workers + ConnectRPC + D1 experiment](experiments/0001-workers-connect-d1.md) passed ordinary local RPCs, D1 CRUD, runtime-restart persistence, and export/restore, but failed both deadline acceptance probes with a Rust clock panic. The follow-up [native Axum + D1 HTTP experiment](experiments/0002-native-axum-d1.md) passed all eight shared checks plus adapter error fixtures, restart persistence, local restore, and disconnected-upstream handling. Native Render + D1 is selected for MVP design, subject to hosted launch checks. No production or cloud deployment was performed.

## Current design gate

The owner approved the [MVP wireframes](../design/mvp-1/wireframes.html) in Q35, the [visual mockups](../design/mvp-1/mockups.html) in Q36, and the [standalone Astro prototype](../prototype/README.md) in Q37. The prototype remains separate, with in-memory synthetic tasks and no Rust server. Production application code has been independently implemented in `/server` and `/web`, with generated RPC clients, durable D1 operations, owner-only Google verification, local development login, and CI/CD workflow definitions. Provider configuration, real Google login, hosted limits, live backup restoration, notifications, and repository settings remain the [launch gates](operations.md).

## Verified constraints

- Standard GitHub-hosted Actions runners are free for public repositories. Larger runners and storage beyond included allowances can cost money. See [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
- GitHub supports disabling pull requests or restricting creation to collaborators; restricting creation alone does not prevent public PR comments. See [pull request controls](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/disabling-pull-requests).
- The official Rust ConnectRPC implementation documents Axum integration and a pre-1.0 dependency. This establishes feasibility to investigate, not a guarantee of production suitability. See [Connect Rust](https://github.com/connectrpc/connect-rust).

Provider limits and prices must be rechecked when selecting services; do not count trials or temporary credits.

## Delivery sequence and review boundaries

1. Shared understanding confirmed in Q33. Individual decisions above are accepted and do not need to be reapproved.
2. Run the accepted technical feasibility experiment for Workers + ConnectRPC + D1. Keep it isolated from production application code and from the website design prototype. Record reproducible commands and actual results, including failures and untested hosted assumptions. No production data is needed.
3. Review the evidence and choose API hosting/database; record a consequential architecture choice in an ADR. If needed, compare the native Render alternatives without building three complete applications. Verify spending controls before provisioning any potentially metered service.
4. Produce MVP workflow wireframes for owner approval, then mockups for approval, then the interactive local `/prototype` for approval. Cover login/access denial, empty/task lists, create/edit/complete/reopen/delete, and loading/error/server-startup states. Detailed layouts remain a design-stage decision.
5. Implement the approved workflow separately in `/server` and `/web`, along with builds, required CI checks, and local coverage/E2E commands. Preserve the future-client repository direction without implementing those clients.
6. Validate Google owner-only access, deployed runtime limits, private encrypted backups and restoration, GitHub failure-email delivery, measurement collection, spending controls, and the repository participation policy. Use manual deployment of a tested revision; no paid services without approval.

Hosted measurements and provider-account settings remain evidence-dependent launch checks. Feasibility work stays isolated under `experiments/`; the approved prototype stays under `/prototype`; production code is separate. No hosting or storage accounts have been changed. The repository is public, with pull requests, issues, discussions, wiki, and automatic merging disabled. The first GitHub CI run passed; `main` requires the GitHub Actions check, blocks force pushes and deletion, and retains the owner's administrative bypass. Collaborator-only interaction limits expire on April 21, 2027 and require renewal, as recorded in [operations](operations.md).
