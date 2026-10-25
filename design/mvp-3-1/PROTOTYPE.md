# MVP 3.1 invitation and account prototype

Status: **wireframes and visual mockups approved; standalone prototype approved; production implementation in progress**. Production implementation, numerical safety sizing, AWS configuration and live rollout remain separate work.

Review question: do emailed invitations, normal account creation, simpler households and owner-only safety controls feel right, including retries and loss of access?

## Open it

The approved disposable source is preserved on local branch `prototype/mvp-3-1-invitations` at `6c403502bd1f23da837155a34fcbce87347e97bb`. It is deliberately excluded from production commits. The local review copy remains at `prototype/public/invitations/index.html`; open it directly:

```sh
xdg-open prototype/public/invitations/index.html
```

On a checkout without the local review copy, recover it from that branch:

```sh
git show prototype/mvp-3-1-invitations:prototype/public/invitations/index.html > /tmp/intrepion-mvp31-prototype.html
xdg-open /tmp/intrepion-mvp31-prototype.html
```

No installation, development server, Rust server, database, credentials, cloud account or real Google login is needed. Nothing is sent or saved outside the tab. Reload or **Reset demo** restores the synthetic starting state; another tab is an independent demo. No browser storage is used.

Alternatively, use the existing prototype development site:

```sh
npm --prefix prototype run dev
```

Open <http://127.0.0.1:4321/invitations/index.html>. If dependencies are not installed, run `npm --prefix prototype ci` first. The direct-file option needs no dependencies. Stop the development server with Ctrl+C when finished.

## First review: invite your spouse

Use **Guided walkthroughs → Invite your spouse** and click each numbered step. The step buttons perform the simulated actions. Watch the application and review-only state summary change:

1. Alex invites Morgan by email.
2. The simulated mail sender delivers the invitation.
3. Morgan opens the email while signed out; no account or household membership is created yet.
4. Morgan selects the matching simulated Google account.
5. Morgan explicitly creates the account and joins as an equal head.
6. Retrying acceptance creates no duplicate account or membership.
7. Open shared shopping. Switch Current space to Personal to verify the separate private space.

For a more realistic form walkthrough, select **Reset demo**, then **Households → Manage household → Invite a head**. Enter `morgan@example.invalid`, review and confirm. Expand **Free-play operational events** and select **Deliver queued mail**. Expand **Simulated recipient mailbox**, choose Morgan and open the email. Switch Google account to Morgan, edit the display name and explicitly create the account and join.

Only the simulated recipient mailbox exposes the review link. Heads and owner administration do not display invitation links. Google-account email is verified/read-only in acceptance; existing accounts keep their name.

## Other walkthroughs

Selecting a walkthrough resets the demo. The selected tab can be changed with Left/Right/Home/End keys as well as clicks.

| Walkthrough                         | What to inspect                                                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wrong account and replacement       | Casey cannot view recipient/household details. Switching to Morgan does not consume the invitation. Send again invalidates the previous link and renews seven-day expiry.                                                       |
| Pause versus email budget           | Manual growth pause blocks sends, resends and joining; delivered valid links remain usable when only the send budget is exhausted. Existing list saves keep working.                                                            |
| Uncertain delivery and suppression  | Automatic retries reuse an invitation and may produce duplicate email; acceptance remains once-only. Reported bounce/complaint destinations are suppressed beyond detailed-log expiry.                                          |
| Departure and suspension            | Removing an issuer revokes their pending invitations. Accepted memberships remain independent. Personal accounts survive household removal; site suspension preserves data and restoration does not restore removed membership. |
| Everyday lists and hidden blocks    | Reusable templates create independent runs/copies. Existing content remains visible during a hidden safety block. Rejected changes are not saved and protected erasure is still available.                                      |
| Protected recovery                  | A snapshot cannot restore later household removals, account suspensions or erased content. Restore clears sessions, pending links and mail, conservatively reconciles send attempts and leaves growth paused.                   |
| Expiry and last-head closure        | Expired links cannot create accounts. Last-head departure closes the household permanently; due protected month-end UTC erasure preserves personal data.                                                                        |
| Existing account and owner boundary | Casey retains their account/name. Household heads cannot use owner controls or access another person’s private content.                                                                                                         |

## Free exploration

- Use **Review as** to simulate Alex (owner), Casey (existing account), Morgan/Taylor (initially unregistered) or signed-out state. These controls are outside the product boundary. Selecting an unregistered identity does not create an account.
- In **Households**, create a household using only its name, invite heads, inspect sending state, resend/revoke invitations, remove another head, inspect household History or leave. Last-head departure explicitly confirms final closure and the scheduled erasure deadline.
- Use **Tasks**, **Shopping** and **Checklists** in the selected personal/shared space. Create/edit content, complete tasks, add items and quantities, add/rename/reorder/remove Sections, move items between Sections, create independent copies/runs, finish/reopen, archive, move to Trash, restore and inspect actor History.
- **Next content save** simulates a pre-save failure, lost response, conflict, expired session or hidden safety block. Editors keep drafts after rejection. Retry acknowledgment deduplicates a saved action. Same-account sign-in resumes an expired-session draft; identity changes do not transfer that draft to someone else.
- At a simulated hard storage block, moving to Trash may fail because it also retains History. **Erase permanently** requires scope confirmation, records simulated recovery protection and removes the selected content/items/History; cancel preserves everything. Independent copies survive.
- Alex’s **Admin** page shows metadata, retained-content measurements, account/household review, email operations, illustrative safety settings, pause/resume, suspension/restoration, audit and recovery review. Other heads have no Admin entry. Private list titles/notes are not shown in account usage views.
- Safety fields start unchosen. You can enter illustrative item-count thresholds for interaction review; they do not authorize launch values. Reaching a soft threshold flags review; reaching a hard threshold blocks increases while preserving saved data. Ordinary users see general unsaved-change feedback and a support route.
- Operational review buttons simulate delivery, bounded uncertain retries, hard bounces/complaints, time passage, email-budget exhaustion, full space storage, snapshots, restore and due household erasure. The starting clock is 25 October 2026. Monthly attempt accounting resets on entering a new UTC month. Detailed mail events age out after 30 days; site audit after one year; current restrictions outlive event logs.

## Boundaries

This is a disposable interaction simulation, independently implemented in `/prototype`. It imports no production or mockup code and will not become production code. The pure in-memory state model and DOM shell are separated within one HTML file. Its complete synthetic state is deliberately inspectable through review tools; production must never expose those tools or rely on client-side authorization.

The new demo focuses on the changed MVP 3.1 flows and representative existing list interactions. The [earlier Everyday lists design](../mvp-2/PROTOTYPE.md) remains the detailed baseline for unchanged list behavior; older household quota/allocation interactions are superseded by the [MVP 3.1 scope](../../docs/mvp-3-1-plan.md).

There are no actual sessions, emailed secrets, cloud retries, signatures, transactional database operations, backups, notification deliveries, cross-tab collaboration or production authorization guarantees. Unknown physical/export sizes and unavailable D1 usage are identified as unknown. JSON content/History byte counts are an illustrative logical measurement, not D1 billing/storage figures. All names, addresses and data are synthetic. Google identities are selected from four examples; this is not a new four-account product limit. Arbitrary mail addresses can be entered but only the synthetic identities can simulate Google acceptance.

The 10,000-attempt monthly mail budget and 80% warning reflect confirmed scope. Displayed base-email estimates exclude other AWS fees and do not guarantee invoice limits. Numerical resource thresholds, sender/support addresses and SES setup are not chosen or provisioned here. Public registration, other login methods, dependent roles/PINs, billing, AI and themes remain deferred.

## Review evidence

Local Chromium review completed all nine guided walkthroughs and realistic form interactions: invitation review, editable new-account names, shared shopping items, literal text escaping, lost-response acknowledgment and same-account shared-draft resumption. Additional form review covered name-only household creation, Sections, item movement, archive/reopen, Trash/restore, hidden-block draft retention, erasure cancellation/confirmation, owner policy review, pause/resume, suspension/restoration, failed direct actions and draft-discard cancellation. Reload resets state and browser storage remains empty.

Desktop (1440px), phone (390px) and narrow phone (320px) layout checks covered list controls, owner overview and policy dialogs. Application controls are at least 44px high. No page errors or external requests occurred during the primary walkthrough review. These are local review checks, not a committed prototype test suite or proof of production behavior/accessibility.

- [Phone invitation acceptance](prototype-invitation-mobile.png)
- [Desktop owner overview](prototype-admin-desktop.png)

Owner verdict: approved. The disposable primary source has been captured on the branch above, as required by the prototype skill. The approved scope/wireframes/mockups and this walkthrough record the validated interaction decisions. Production code is implemented independently; retain the source reference rather than importing this HTML/model.
