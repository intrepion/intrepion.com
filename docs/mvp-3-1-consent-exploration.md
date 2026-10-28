# Invitation request consent: exploration

Status: **exploration, not approved**. The owner chose to design an in-app consent process before production invitations. This may amend the approved MVP 3.1 invitation flow; it does not authorize implementation or launch. The existing feature process still requires approved wireframes, mockups and a separate local prototype before production changes.

## Why this is needed

AWS's production-access form asks the sender to acknowledge that recipients explicitly requested email. In the existing design, a household head enters another person's address and the system sends an invitation. That action alone does not establish that the recipient requested it. Do not claim the existing behavior meets the acknowledgment. The application already has local tests for authenticated feedback and suppression, but the provider integration and production deployment are not yet ready; do not claim those controls are active in production.

## Chosen entry point: household request link

1. A current head creates a link that lets someone initiate a request to join that household. The head shares it directly, for example in person or through a message they choose. The app sends no email at this step.
2. The prospective recipient opens the link, signs in with a verified Google identity, and explicitly requests an invitation email to the verified address. The request must be clear about what will be sent and allow cancellation.
3. A current head reviews the request within the app and decides whether to send the invitation. Do not disclose household content before acceptance. A request does not create an account, grant access, or accept membership.
4. After a request and head approval, the existing private, time-limited email invitation is delivered. The recipient signs in with the same matching Google identity, reviews equal-head authority and History access, and explicitly accepts.

The owner chose a household link as the entry point. Q1–Q3 are agreed: Google sign-in precedes the explicit email request; a current head approves or declines each request; and heads may reuse an expiring, revocable link for multiple people. Q4–Q6 are agreed: request links expire after seven days, a visitor sees only a generic request screen before sign-in and the household name afterward, and requests expire after seven days. Q7 is amended: heads should receive notification emails in this MVP. Q8–Q11 are agreed: each head opts in explicitly, each opted-in current head receives one notice per new request, repeat attempts for a pending request do not send additional notices, and notification attempts share the existing monthly application sending ceiling. Requests remain visible in-app when notification delivery is blocked. The remaining behavior below needs decisions. The existing requirement for the actual invitation to arrive by email remains in place.

## Revocation and withdrawal decisions (Q12–Q15)

- Revoking a request link cancels its pending requests. Already issued email invitations and accepted memberships are unaffected; a head may revoke an individual invitation separately.
- A link creator's departure, removal or site-wide suspension revokes their request links and cancels pending requests made through those links. Other heads can create new links.
- A recipient can withdraw a pending request. After issuance but before acceptance, withdrawal revokes the invitation and cancels unsent delivery. Accepted memberships are unaffected.
- After a decline, the same Google identity cannot request again through the same link for seven days. A head can share a different link to allow an earlier request.

## Identity and review decisions (Q16–Q19)

- Keep at most one pending request per Google identity per household, including across different request links. Repeat attempts show the existing request and do not generate additional notifications.
- Bind the eventual email invitation to both the Google subject and verified email used for the request. If the address changes, require a new request before sending to the new address.
- Show current heads the requester's Google display name, verified email address and request time, with Approve and Decline actions; do not show the Google subject.
- For competing head decisions, the first confirmed decision wins. Other heads see the result, and approval creates at most one invitation.

## Expiration, closure and retention decisions (Q20–Q23)

- Technical retries and explicit Send again are allowed while the requester has not withdrawn or accepted, for at most 30 days from the request. A later invitation requires a new request. Explicit Send again replaces the prior invitation link.
- Natural request-link expiry prevents new requests but does not cancel already pending requests before their own seven-day deadline. Explicit revocation has the separate Q12 behavior.
- Household closure revokes request links and cancels pending requests, unsent notifications and unaccepted invitations, followed by the existing protected household-erasure schedule.
- Retain requester-identifying details and consent records for 30 days after the request or resulting invitation reaches a final state, then remove those identifiable details. Retain a household History entry that a request and decision occurred without the requester's email or Google identity.

## Head notification decisions (Q24–Q27)

- Notify a head with the household name, a generic statement that someone requested an invitation, and a link to review in the app. Keep the requester's name and email in the authenticated app.
- Send only to the head's verified Google email. If it changes, pause notifications to the new address until that head explicitly confirms it in the app.
- Opting out stops future notifications and cancels queued notifications and retries for that head; pending requests remain visible. Notification emails link to the setting for turning them off.
- Opting in applies to new requests going forward; it does not send notices for older pending requests.

## Shared controls, recovery and consent wording (Q28–Q31)

- Any current head can revoke any household request link. The link's pending requests are canceled, according to Q12.
- A site-wide growth pause blocks creating request links, new requests, approvals and invitation sending. Existing requests remain visible, and withdrawal, link revocation and notification opt-out remain available.
- After restoring an older backup, revoke request links, cancel pending requests and unsent notifications, and turn head notification opt-ins off. Heads can create links and opt in again after recovery.
- Before a recipient requests mail, show the household name and verified email and explain that an invitation may be sent there, including technical retries and a head's resend within 30 days. Require an explicit Request invitation email action. This is not marketing consent.

The owner asked why growth pause exists. It is an existing site-owner operational control from MVP 3.1, intended to stop invitation/admission growth during abuse, delivery problems or recovery while existing personal and household use continues. It is not intended as a routine household-head control.

## Self-service, pausing and safety controls (Q32–Q35)

- Provide a My invitation requests page where a person can sign in with the same Google identity and view or withdraw their own pending requests and unaccepted invitations, even after closing the browser or after the request link expires. This does not create a full account.
- During a growth pause, hold already queued request notifications until growth resumes; cancel them if the underlying request expires, is withdrawn or is decided while waiting.
- Keep requests visible despite notification failure; show notification failure in the head's settings and provide operational detail in owner Admin. Do not claim delivery merely because a provider accepted a message.
- Use configurable hidden safety limits and rate controls for links, requests and notifications, with owner-visible flags. Exact launch values remain subject to measurement.

## Existing accounts, private links and sending limits (Q36–Q39)

- Existing Intrepion accounts may request another household using the same process, retaining their account and display name. Access begins only after acceptance. Suspended accounts cannot use it.
- A head can copy and share a request link. Opening or scanning it creates no request and grants no access. Do not put its secret in logs or browser storage.
- If the monthly sending ceiling has been reached, approval does not complete; retain the pending request, show generic unsaved feedback, and let the head retry while it is valid. Do not silently send later without a confirmed approval.
- Existing permanent-bounce and complaint suppression also applies to head notifications. Suppressed heads keep access to pending requests in the app; only the site owner can review and clear suppression.

## Notification preferences and outcomes (Q40–Q43)

- Notification opt-in is per head, per household.
- Retry temporary notification failures in a bounded way within the shared attempt budget. Provider uncertainty can lead to duplicate delivery; do not promise exactly-once email delivery.
- Do not email a requester that a head declined; show the decline on My invitation requests.
- If the head who approved and issued an invitation leaves, is removed, or is suspended, revoke that head's unaccepted invitation and cancel unsent delivery. Accepted memberships remain valid.

## Identity errors, accounting and recovered retention (Q44–Q47)

- A Google account without a verified email cannot submit a request. Explain that a verified address is required and offer account switching.
- My invitation requests requires a fresh Google sign-in and shows only requests for that Google identity. This limited request-management sign-in is not full account creation.
- Request links, requests, consent records and queued notifications count toward retained storage while they exist. Normal-user limits remain hidden; the site owner receives operational detail.
- Recovery applies the 30-day identifying-data removal rule before the restored database is used, so older backups cannot restore expired identifiable details into active use.

## Consent evidence and concurrency (Q48–Q51)

- Retain the request time, consent-wording version, household, and Google identity and verified address used for a request, but never the Google login token. Remove identifying details on the agreed 30-day schedule.
- A current head opening their own household's request link is told they are already a head; create no request and send no notice.
- Provider acceptance without delivery confirmation is shown as Delivery not confirmed. Only show definite notification failure when evidence supports it; retain in-app access to requests.
- Concurrent approval, withdrawal, link revocation and household closure produce one atomic consistent result. If withdrawal or revocation wins first, no invitation is issued; if approval wins, a later withdrawal revokes the unaccepted invitation.

## Account switching, shared budget, log retention and link sharing (Q52–Q55)

- When a person signs in with the wrong Google identity for an emailed invitation, explain which account is required and offer account switching. Do not consume the invitation.
- Invitations and head notifications use the shared monthly sending ceiling without separate quotas. Enforce it correctly under concurrent sends.
- Detailed notification delivery records follow the existing 30-day email-log retention. Owner Admin may show delivery and suppression metadata but not private request-link secrets or household content.
- A reusable request link may be shared further. Each person independently signs in, requests email and receives head approval; link possession grants no membership. Explain this to the head when they create a link.

## Final timing, retries and visibility decisions (Q56–Q58)

- An invitation email may be sent only within 30 days of the request. A link issued inside that window remains valid for its own seven days, even if acceptance occurs after day 30; later resending requires a new request.
- Stable action identities permit a safe retry after a lost confirmation without another request, decision, or set of notifications.
- Owner Admin shows counts, delivery failures, suppression, usage and abuse flags, excluding private request-link secrets and household content. Existing email-operation records may show recipient addresses for troubleshooting under the 30-day retention policy.

## Questions tracked during exploration

- Settled: a household link is the entry point for a recipient to request an invitation. The actual invitation continues to arrive by email.
- Settled: before Google sign-in the visitor sees a generic household request screen; after sign-in they see the household name and explicit request button, but no household content. Enumeration and identity details remain open.
- Settled: a link is reusable, expires after seven days, and can be revoked; creator departure, removal or suspension revokes it and cancels its pending requests. Optional recipient scoping and household-closure behavior remain open.
- Settled: the recipient signs in with Google before requesting mail; this does not create an account. Exact identity binding and recovery behavior remain open.
- The recipient consent wording, proof retained, retention period, cancellation and any permissible invitation resend or reconfirmation behavior. Heads explicitly opt in to request-notification emails; opt-in defaults off and is offered when creating a link and in Household settings.
- Settled: a current head approves or declines each request before an invitation is sent; a request expires after seven days. Each opted-in current head receives one notification per new request; duplicate attempts on a pending request do not generate another. Notification attempts count toward the shared 10,000-attempt UTC-month ceiling; delivery failures leave requests visible in-app. Other duplicate-request handling, retries, spam controls and capacity limits remain open.
- How existing registered accounts, suspended people, changed email claims, wrong Google accounts, browser reload, lost responses, backup recovery and invitation replacement behave.
- How to preserve the approved equal-head, personal-privacy, abuse-limit, no-public-account-registration and protected-recovery rules.
- Availability of other identity providers is deferred unless the owner changes scope.

## Provider setup boundary

The SES sender domain and DKIM are verified, the account remains in the sandbox, and the user has selected à-la-carte pricing. No production-access acknowledgment should be submitted until its statements are true for the intended rollout. Existing local feedback/suppression tests do not establish that live SNS delivery, redrive, monitoring or deployment are working. Review those separately before production sending.

AWS sources: [Request production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html); [SES pricing plans](https://docs.aws.amazon.com/ses/latest/dg/pricing-plans.html).

The consolidated [draft scope](mvp-3-1-consent-plan.md) incorporates Q1–Q58 and is awaiting owner review. Earlier open-question bullets above preserve the exploration history; use the consolidated draft for the current proposed behavior.
