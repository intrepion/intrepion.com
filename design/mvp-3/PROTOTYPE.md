# MVP 3 Household foundation prototype

Status: **wireframes, mockups and interactive prototype approved by the owner; production implementation in progress**.

Review question: do private/shared spaces, equal-head access, own ceilings, pooled capacity and departure/closure behave as expected when used with everyday lists?

## Open it

The entire demo is [one self-contained HTML file](../../prototype/public/households/index.html). Open it directly, without installation or a server:

```bash
xdg-open prototype/public/households/index.html
```

Alternatively, use the existing prototype website:

```bash
npm --prefix prototype run dev
```

Then open <http://127.0.0.1:4321/households/index.html>. If prototype dependencies are not installed, first run `npm --prefix prototype ci`. Earlier prototypes remain at `/` and `/everyday/`.

No Rust server, database, cloud account, token or real Google login is involved. Reloading or **Reset demo** clears all changes. Nothing uses browser storage. In-memory invitations only work within the current tab; a newly opened tab starts a separate synthetic demo.

## Suggested review

Expand **Guided walkthroughs and review scenarios**. Selecting a walkthrough resets the demo. Click its numbered steps in order, watching the application and readable state summary below the review controls.

| Walkthrough            | What to watch                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Invite a head          | Casey sees nothing until accepting a recipient-bound invitation, then gains access to existing shared History without contributing capacity.                                   |
| Own ceilings           | Alex can restrict themselves, cannot change Morgan's ceiling, and cannot create above their own ceiling. Existing content remains.                                             |
| Retained contributions | Withdrawal is blocked while shared content needs its capacity. After replacement capacity arrives, a former head can withdraw without regaining content access.                |
| Independent copies     | A personal template becomes a complete household copy; a run is another independent copy. Changing the private original changes neither household copy.                        |
| Close and erase        | The last head leaves without a successor. Closure is final; month-end erasure can fail without releasing capacity. Retrying successful protected erasure releases allocations. |
| Lost save response     | The simulated server saves while the page waits. Use **Retry acknowledgment** in the dialog, then continue the numbered steps. The task appears once.                          |

The simulated clock starts on 22 October 2026. Calendar month-end is 1 November 2026 at 00:00 UTC; your local deadline is displayed in the closure confirmation. **Advance to month-end** moves only the demo clock. **Run scheduled erasure** is a review control, not a real scheduler.

## Explore freely

- Use **Review as** to switch among Alex, Morgan, Casey, an unapproved account and signed-out state. These controls are outside the product UI; they never grant access in the real app.
- Switch between Personal and Maple household. Use Tasks, Shopping and Checklists. Create/edit tasks and collections, mark shopping items purchased or needed again, add/rename/remove/reorder Sections, move items, create runs, finish/reopen, and inspect content History.
- Copy personal content into a household through an explicit capacity preview. New runs and copies have fresh History and creator attribution. Personal content remains private.
- In Household, invite known approved recipients, revoke invitations, remove another head, set only your own ceilings, leave, or explicitly erase all shared content. Removing a head preserves shared content and their retained contributions.
- In My capacity, manage only your own contributions. Every resource has an independent input and confirmation preview. Household Usage shows only shared contributions; it does not reveal other people's private remainders or unrelated allocations.
- Move content to Trash, restore it or explicitly erase it. Archived content and finished runs are read-only until reopened. Trash still counts. In the demo, erasing an individual item also clears its list's associated content History; the confirmation explains this scope. Independent copies elsewhere remain.
- Choose **Next content save** before opening an editor to simulate a pre-save failure, lost response, conflict or session expiry. Failed/conflicting edits retain their drafts. Conflict recovery shows the latest saved values for review before retaining/merging the draft. Signing back in with the same synthetic identity resumes an expired-session draft; switching identity discards access to that draft.
- **Simulate full household storage** blocks History-producing edits while allowing viewing and permanent erasure. **Simulate lower item capacity** preserves existing content but blocks increases to the exceeded dimension. These are explicitly simulated operator changes, not actions available to household heads.
- **Review-only simulated state** exposes all synthetic identities to explain the model. It is intentionally outside the application privacy boundary and must never exist in production.

## Boundaries

All numeric allowances and text/storage accounting in the demo are illustrative, not approved pilot caps. The demo meter uses a documented-in-code serialization of retained content and History, not provider database size or export size. The initial example plan has resource budgets, a three-household limit and uniform per-collection caps. Actual values still require measurement and explicit prelaunch approval.

Membership checks, quota transactions, Google identity, clock advancement, conflicts, operation receipts, erasure protection and GitHub notifications are simulations. There are no real API requests, cross-tab synchronization, backup archives, notification deliveries or authorization guarantees. The static demo is a design review artifact, not a substitute for production verification.

Non-head members, PIN access, Categories, multiple named task lists, billing, automatic invitation email, live collaboration, other clients, AI and themes remain deferred.

The prototype is independently implemented in `/prototype`; it imports no production or mockup UI code. The pure in-memory domain simulation is separate from the DOM shell inside the single file. Neither will be promoted into production. Production implementation follows prototype approval as a separate step; launch and numerical allowance approval remain separate gates.

## Review evidence

Browser review completed all six walkthroughs, including forbidden ceiling changes, withdrawal blocking, independent copies, failed erasure retention and a single acknowledged task after a lost response. Additional form review covered household creation, invitation acceptance, own ceilings, allocation previews, item creation, section rename/removal, Trash restoration, conflict review, expired-session draft resumption and full-storage rejection. Literal HTML in a title rendered as text. No page script errors or external requests occurred in the walkthrough review.

Desktop (1440px), phone (390px) and narrow phone (320px) shopping layouts had no horizontal overflow or application buttons below 44px high. Phone shopping and closure previews were visually inspected. These checks do not establish full accessibility conformance or production behavior. Astro check reported no errors, warnings or hints, and the prototype website built successfully. No prototype test suite was added.

- [Desktop shopping](prototype-shopping-desktop.png)
- [Phone shopping](prototype-shopping-mobile.png)
- [Phone capacity](prototype-capacity-mobile.png)
- [Phone closure confirmation](prototype-closure-mobile.png)

After approval, record any requested behavioral changes in [the MVP 3 plan](../../docs/mvp-3-plan.md), then begin separate production implementation. Keep this artifact as a reference for the approved interaction decisions.

## Approved storage-recovery amendment

The owner approved explicit permanent erasure of selected active content when full storage prevents adding Trash History. The full-storage wireframe and mockup now show the existing scope-confirmation pattern for this entry point. In the standalone prototype, simulate full storage, open a task or collection, and choose **Erase permanently · storage recovery**. Cancel keeps the content; confirmation removes the selected target and associated child content/History, leaves independent copies alone, and simulates recovery protection before freeing capacity. Normal Trash behavior is unchanged.

## Create-household slider amendment

The owner requested sliders and half-maximum defaults as a minor correction to the approved creation workflow. Each resource now has a slider and synchronized exact-number field. Available maximum means personal capacity minus retained personal usage, with existing household allocations already reserved. Defaults round half down to whole units, including bytes; zero availability stays zero. Existing review/confirmation, privacy, name-storage requirements and server validation still apply. The wireframe and visual mockup precede the independent standalone prototype implementation; production code is implemented separately.
