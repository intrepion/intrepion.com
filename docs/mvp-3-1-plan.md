# MVP 3.1: Normal household invitations

Status: **scope confirmed by the owner at Q24; wireframes and visual mockups approved; standalone prototype approved; production implementation in progress**. Review the [wireframe guide](../design/mvp-3-1/README.md). The interview history below records amendments. This scope does not waive the wireframe, mockup, standalone-prototype, implementation-verification or production-launch gates. No MVP 3.1 application code, AWS resources, credentials, DNS or outbound messages have been changed.

## Confirmed scope

### Everyday account and household flow

- Invitation-only registration produces normal accounts; remove the three-person pilot and per-person operator admission step. Existing users keep their accounts and personal data. Personal-only use remains possible after household departure.
- An active head enters a recipient email; AWS SES delivers a private invitation link only to that mailbox. A recipient opens it, signs in with the matching Google email, confirms a display name if new, reviews the household and equal-head authority/retained-History access, and explicitly accepts.
- Create a new account and membership atomically on successful acceptance, with durable retry receipts. Keep the stable Google subject as identity; never merge or transfer accounts merely because email addresses match. A wrong Google account can be switched without consuming the link.
- Any current head may invite eligible people within sending/abuse controls. Opening links, email scanners and Google sign-in alone do not accept invitations or expose household content to an unauthorized person. Keep household details behind the invitation and matching identity checks.
- Show delivery state, Send again and Revoke. Links are single-use and valid for seven days. Explicit Send again invalidates the old link and refreshes expiry; automatic technical retries reuse the current pending invitation. Cancel unsent/retry work for invalidated invitations. Revoke invitations issued by a head when that head leaves, is removed or is suspended. Accepted memberships do not depend on the inviter remaining.
- Use normal account language throughout the website instead of pilot/approved-person labels. An unregistered Google identity is directed to its invitation rather than silently enrolled.
- Household creation asks for its name. Preserve the visible Households directory and management flow; remove normal-user My capacity, plan/usage meters, allocation sliders and individual head count-ceiling controls. Dependent profiles, PIN access, other login methods and billing remain later work.

### Hidden resource safety and migration

- Personal spaces and households each use separate hidden safety budgets. Retire per-user reserved contributions and old individual head ceilings. Retain recorded allocation history; preserve all content, History and actor attribution. Do not automatically copy personal data into shared spaces or delete records to fit new policies.
- Use generous configurable backend safety thresholds, soft owner-visible flags and high hard limits against abuse/resource exhaustion. Archive, Trash, retained History and closed-household data remain accounted for. Preserve viewing and explicit protected erasure when growth is blocked.
- For resource-blocked actions, show general, non-numerical feedback that states the change was not saved and gives a support route. Keep actionable conflict, connection and identity-recovery behavior. The admin receives the detailed blocking reason.
- Last-head departure remains final household closure with protected month-end UTC erasure. Existing account suspension, personal-data separation and content-erasure guarantees remain in force.
- Calibrate exact safety thresholds against current data, representative workload/metadata growth, provider headroom and protected backup/recovery limits before launch. Numerical generosity is not a promise of unlimited storage or spending. No arbitrary three-account replacement cap is implied.

### Owner administration

- Initially only the configured owner's Google identity has site-wide admin access. Household-head status grants no site-wide privileges. Keep operator credentials out of browser builds and retain a separate recovery path.
- Show account/household counts, retained storage, growth, sending activity and review flags, not private task/recipe contents or invitation secrets. Distinguish logical bytes, physical/export sizes and provider measurements; show unavailable/stale measurements honestly.
- Allow confirmed, audited threshold changes, growth pause/resume and account suspension/restoration. Suspensions preserve data, end account access and cannot be bypassed by an invitation. Preserve the sole administrator's recovery path.
- Manual Pause growth stops new invitations, queued sends, resends and acceptance, while existing accounts/lists keep working. Expiry still runs. Exhausting only the mail budget stops sends without invalidating already delivered valid invitations.
- Retain detailed mail-delivery logs 30 days and site-admin audit events one year. Household History keeps its existing retention. Keep current minimal suspension/suppression state effective beyond event-log expiry, subject to explicit erasure/privacy handling.

### SES and operations

- Use AWS SES à-la-carte in one region, with the existing DNS/inbox routing preserved. A dedicated sender subdomain and actual monitored support/reply mailbox are setup inputs to confirm privately. Complete sender verification, production access, least-privileged credentials and delivery/feedback verification before enabling live onboarding.
- Start with at most 10,000 application send attempts per UTC month and an owner warning at 80%; increasing this requires owner review. At the researched base rate this is approximately $1 in sending, with data/other AWS charges separate. Preserve the existing overall project spending policy; application ceilings are not an AWS invoice guarantee. Exclude trials/introductory credits from assessments and do not enable unrelated paid add-ons.
- Use bounded automatic retries and durable send state, accepting possible duplicate email after uncertain SES outcomes. Do not promise exactly-once SES handoff. Duplicate email must never duplicate account creation or membership.
- Suppress automatic sends after reported hard bounces/complaints. Show the inviter a general delivery failure; only the owner may review/clear suppression. Do not claim detection of every provider's spam complaints. Use authenticated, deduplicated feedback intake and independently delivered operations alerts.
- After restoration, clear pending invitation/onboarding tokens and queued email, clear auth state, and keep growth paused for owner review. Extend independent recovery protection so later account suspensions and head removals cannot be rolled back into renewed access. Preserve current erasure/closure protection.
- Keep infrastructure plans/spending controls, Google authentication, CI on pushes/PRs, local-only browser E2E/coverage, and invitation-only repository participation. Deployment remains a manual action on a passing exact revision.

## Delivery gates and deferred configuration

1. Confirm this consolidated scope. **Completed at Q24.**
2. Produce wireframes for owner approval, then visual mockups for approval, then the separate local server-free prototype for approval. Prototype application code does not become production code.
3. Implement separately, preserving the approved real RPC/local D1, browser/real API and protected recovery test boundaries. Cover identity isolation, concurrent accept/revoke/remove/suspend/pause, migration, delivery uncertainty and post-backup security changes.
4. Measure and obtain approval for concrete hidden safety numbers, prepare provider/setup and rollback commands, and verify current recovery/spending headroom. Collect sender/support addresses and AWS setup inputs privately; do not ask for login tokens or passwords in chat.
5. Obtain the concrete live-rollout approval, deploy a passing exact revision, and verify owner/recipient Google sign-in, email receipt, real persistence, admin restrictions, authenticated feedback and protected recovery.

Recheck production state before migration. If unexpected legacy pending invitations appear, stop for review rather than silently deleting them or admitting their recipients. Pending-invitation absence observed during research is not a permanent assumption. Existing accepted memberships are preserved.

## Current implementation facts

Current invitations target an existing approved account's public ID, store its stable Google subject and a token hash, expire after seven days and require authenticated acceptance. New Google accounts cannot reach acceptance because authentication first checks the operator-approved account registry. The website can create and manage households, but admission and initial resource plans currently require the private operator API.

Changing this requires an onboarding path before normal account access, atomic invitation/account/membership admission, and a replacement resource-safety/admission policy. The owner accepted invitation-only registration for normal accounts. The existing privacy, revocation, retry, conflict and erasure-aware recovery boundaries need explicit coverage.

## Decision tree

The first frontier contains delivery/recipient selection, the overall automatic-admission budget and initial account allowances. These decisions unlock recipient ownership verification, existing-account and revoked-account treatment, account-slot reservations, concurrency/retries, acceptance and cancellation behavior, personal-account persistence, email-data retention and operational safety limits.

Google's official guidance distinguishes Gmail/verified Workspace email assertions from third-party Google-account email assertions; a generic `email_verified` claim alone does not settle current ownership of every address. Supported-recipient and ownership-verification decisions remain open until recipient binding is chosen. Identity research is delegated separately; Google subject remains the durable account identity.

## Round 1: original proposals, superseded by the owner’s answers

- Q1: enter the recipient's email address and create a private link that the inviting head shares themselves. Do not add automatic invitation-email delivery in this release.
- Q2: keep an operator-configurable initial maximum of three admitted pilot accounts in total, including the owner. Review account-wide D1 usage before enabling automatic onboarding; within the configured budget, acceptance needs no per-person operator action. A full budget blocks new admission without affecting existing users.
- Q3: assign newly admitted people the existing starter plan: 250 retained items, 10 shopping lists, 10 templates, 25 runs, 131,072 logical storage bytes and two simultaneous headed households. Joining contributes no personal capacity automatically. Existing users retain their own configured plans and the shared structural limits remain 100 items/20 sections per collection.

Later rounds must settle budget recycling and disabled identities, pending-invitation reservations, abuse limits, supported Google email assertions, identity changes, link leakage and account enumeration, invite revocation/expiry, household closure/removal races, last-head retention, legacy invitations and backup protection. Do not silently assume these policies from the proposals above.

## Identity research

Read-only source inspection confirms that current Google claims retain `sub` and `nonce`, not verified email/Workspace claims. Approval is checked before session creation; invitations have an existing-account foreign key and acceptance currently batches membership, acceptance, History and its retry receipt. New enrollment must preserve this atomicity. Existing operator revocation blocks subsequent sessions and must receive an explicit onboarding policy.

Primary references: [Google ID token verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token) and [Google OpenID Connect identity claims](https://developers.google.com/identity/openid-connect/openid-connect#obtainuserinfo). The supported-email, optional display-name, changed-email, revoked-account and safe-resumption branches remain open.

## Round 1: owner answers and scope amendments

- Q1 amended: email must actually be set up and invitations delivered by email. Copy-and-share links alone do not meet the request.
- Q2 rejected: remove the three-account pilot model and per-person operator approval. The owner wants a regular account and to invite their spouse to create a regular account. This does not by itself settle public registration versus invitation-only registration.
- Q3 amended: reconsider the old starter limits, make them more generous, hide user-visible limits and use a general error when an action cannot proceed. Add an administration overview that highlights suspiciously large usage. Exact thresholds, hard-versus-soft enforcement, normal-user allocation controls and admin authority remain open. The agent recommends clear unsaved-action feedback without exposing numerical thresholds; this recommendation is not yet accepted.

At this interview round no paid provider or spending change had been selected. Later Q13/Q15 select SES and the application sending budget; provisioning remains subject to the design/setup/launch gates. Existing hosting spending controls are preserved. Trial credits are excluded from affordability assessments.

## Round 2: accepted

- Q4: keep registration invitation-only for this release, while creating normal accounts automatically when emailed invitations are accepted. Do not retain the three-person pilot limit or individual operator approval.
- Q5: remove the ordinary-user plan/usage dashboard and manual capacity-allocation step; normal household creation asks for a name. Retaining or changing pooled contribution accounting and migrating existing allocations are downstream decisions, not implied data deletion.
- Q6: replace subscription-style allowances with generous configurable backend safety thresholds: soft owner-visible flags before high hard abuse/resource caps. Preserve saved content and the existing infrastructure spending controls. Measure exact numbers later.
- Q7: use a general non-numerical message for blocked resource actions that clearly says the change was not saved and gives a next step; the administrator receives the detailed reason. Keep conflict, identity and connection recovery behavior distinguishable where needed to recover safely.
- Q8: only the owner’s Google account accesses the global administration overview initially. Household-head authority remains confined to its own household. Show per-account/household counts, retained storage, growth and flags; do not display private task or recipe contents.

The owner accepted Q4–Q8 individually: invitation-only normal accounts, hidden user-facing capacity controls, generous backend safety thresholds with soft admin flags, clear general unsaved-action errors and an owner-only metadata administration view. These choices do not assign numerical caps or settle the replacement accounting model.

## Round 3: Q9–Q12 accepted; Q13 amended to AWS SES

- Q9: use separate hidden safety budgets for each personal space and household, without reserving user-provided capacity or requiring contributions. Preserve existing content, History, attribution and recorded allocation history; define migration explicitly. Future paid subscription funding is deferred.
- Q10: invite the email address used for Google sign-in, and require the accepting Google account to match that address as well as possess the private emailed token. A wrong account can switch accounts without consuming the invitation.
- Q11: show inviting heads delivery status, Resend and Revoke controls, without exposing the private acceptance link or token to them or the admin. Generate recipient secrets server-side and send only to the intended mailbox; scanners and GET requests do not consume acceptance.
- Q12: let the owner admin adjust safety thresholds, pause new invitations/registrations, and suspend/restore accounts, using explicit confirmations and administrative audit records. Suspension does not erase data; a new invitation does not bypass a site-wide suspension. Household-head removal still affects only that household.
- Q13: use the ongoing Resend Free transactional-email plan initially, with a verified sending subdomain and application send ceilings below provider quotas. Do not enable paid overages or modify existing mailbox/root MX settings. Provider account setup and live delivery checks follow design/implementation readiness.

Registration remains atomic with explicit acceptance. Real accounts and personal data survive household departure; current revocation, closure and protected-erasure guarantees remain in force. Email delivery/retry state, idempotency, abuse limits, migration of pending legacy invitations, recovery token invalidation, admin audit retention, sender identity, support handling and measured safety numbers remain later branches.

The owner accepted Q9–Q12 individually. Separate hidden personal/household safety budgets replace reserved contributions; email acceptance must match the Google sign-in address; acceptance secrets are delivered only to the recipient mailbox; and owner administration includes threshold adjustment, admission pause and account suspension/restoration with confirmations and audit records. Exact numerical policies and migration details remain open.

The original Q13 Resend proposal was not accepted. The owner requested a broader comparison including AWS SES, with pros, cons and a recommendation, then selected AWS SES to avoid a later migration. No paid account, email provider, DNS record or outbound email has been provisioned or sent. [Email options research](research/mvp-3-1-email-options.md) now includes ongoing-free and low-cost paid alternatives, explicitly excluding timed trials/credits.

## Q13: selected provider

Use AWS SES for invitation email. Plan for single-region à-la-carte sending rather than assuming the default Essentials rate. Do not count introductory credits or time-limited allowances. Preserve existing DNS hosting and inbox/root MX settings. Sender verification, production sending access, least-privileged credentials, feedback intake and live delivery checks remain implementation/launch work after the design gates; no AWS resources or messages have been created by this decision record.

AWS pricing at the research date is $0.10 per 1,000 outbound recipients on à-la-carte, with data and optional-service charges separate. New account/region combinations may default to Essentials at $0.16 per 1,000: [pricing](https://aws.amazon.com/ses/pricing/), [plan management](https://docs.aws.amazon.com/ses/latest/dg/pricing-plans.html). The monthly application send budget is a separate decision, not an AWS-guaranteed invoice cap.

## Round 4: accepted

- Q14: retire old individual head count ceilings alongside the contribution model. Heads share each household’s hidden safety budget; do not leave a legacy low ceiling silently blocking normal use. Preserve recorded content, History and attribution, and preserve closure/erasure guarantees. Exact migration is separately verified.
- Q15: start with an application-wide ceiling of 10,000 SES send attempts per UTC month ($1 base sending at the selected rate), owner warning at 80%, and explicit owner review before raising it. Count uncertain attempts conservatively. Additional AWS charges remain monitored within the existing project spending policy; this does not guarantee an absolute AWS invoice ceiling.
- Q16: retry temporary sending failures automatically with bounded attempts, accepting possible duplicate invitation emails after provider uncertainty. All automatic retries reference the same pending invitation; account creation and membership acceptance remain once-only.
- Q17: an explicit Send again revokes the previous acceptance link and sends a fresh link with a new seven-day expiry. Automatic technical retries do not rotate that link. Opening/scanning a link never joins a household.
- Q18: stop automatic sends to addresses with reported hard bounces or spam complaints. Show the inviting head a general delivery failure; expose detailed feedback to the owner admin. Only the owner may clear a suppression after review. Existing independent GitHub operations notifications remain available for infrastructure failures; do not claim all mailbox providers report complaints.
- Q19: new people confirm an editable display name, prefilled from Google when available, before accepting; existing people retain their current account name. The Google identity and matching invited email are not editable identity fields.

Later dependent branches include event-log retention and admin detail fields, recovery invalidation of pending email links, legacy invitations and membership/closure races, numerical safety calibration, and concrete sender/support mailbox configuration. These are not resolved by the proposals above.

The owner accepted Q14–Q19 individually: retire head count ceilings, use the 10,000-attempt monthly application mail ceiling and 80% warning, allow bounded automatic retries with possible duplicate emails, rotate links on explicit Send again, suppress reported hard-bounce/complaint destinations and confirm new-user display names.

## Recovery and migration facts

A read-only production aggregate query during this planning round found one approved account and zero pending invitations (including zero unexpired pending invitations). This is a point-in-time observation and must be rechecked before migration; there are currently no pending legacy links to preserve.

Existing protected recovery clears sessions/login challenges and replays erasure/household-closure records, but does not replay ordinary account suspensions or head removals. Pending invitation rows otherwise survive a snapshot restore. Therefore, a restore can reinstate a privilege revoked after the snapshot. This must receive an explicit MVP 3.1 policy before multi-account onboarding. Existing ordinary inviter departure/removal/suspension also does not cancel that inviter’s pending links unless the household closes.

## Round 5: accepted

- Q20: revoke pending invitations issued by a head when that head leaves/is removed from the household or is suspended site-wide. Another active head may send a fresh invitation. Already accepted memberships are not undone by inviter departure.
- Q21: provide a manual Pause growth switch that blocks new invitations, queued sends, explicit resends and invitation acceptance until resumed, while existing accounts and lists remain usable. Expiry continues normally. Merely exhausting the email-send budget stops sending attempts without blocking acceptance of an already delivered valid invitation.
- Q22: retain detailed email-delivery logs for 30 days and site-admin audit events for one year. Household administrative/content History keeps its existing retention until explicit protected erasure. Retain current minimal suspension/suppression state for as long as its block remains effective; event-log expiry does not lift restrictions. Erasure/privacy rules take precedence over retaining unnecessary personal information.
- Q23: after protected restoration, invalidate pending invitation/onboarding tokens and queued mail, and keep growth paused for owner review. Extend independently stored security protection to prevent a snapshot restore from undoing later account suspensions or household head removals. Preserve existing content-erasure protection and do not resurrect old acceptance links.

Sender/support addresses are required setup inputs to collect privately before live delivery, not a request to post passwords/tokens in chat. Measured backend safety numbers and the detailed operational design will be reviewed before launch; provider choice does not waive the existing spending, design, test or deployment gates.

The owner accepted Q20–Q23 individually: invalidate pending invitations from departed/removed/suspended inviters; pause the entire invitation/admission flow independently of ordinary account use; retain detailed email logs 30 days and site-admin audit one year; and extend protected restoration to invalidate pending email credentials while preserving later suspensions/head removals.

## Decision-tree status

Product scope is consolidated above. The remaining concrete values and provider/mailbox inputs are explicitly assigned to design, sizing and setup gates rather than silently chosen. The owner agreed to Q24, confirming this scope and authorizing wireframe preparation. The owner approved the [28-screen wireframes](../design/mvp-3-1/wireframes.html). The owner also approved the [visual mockups](../design/mvp-3-1/MOCKUPS.md). The owner approved the [standalone prototype](../design/mvp-3-1/PROTOTYPE.md), authorizing separate production implementation. Prototype approval, production implementation and deployment retain their separate gates.
