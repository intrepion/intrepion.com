# MVP 2 standalone prototype review

Review question: do the approved Everyday lists workflows feel right during repeated real-world use, including recovery from mistakes and uncertain saves?

Status: **prototype approved by the owner; production implementation authorized**. This is throwaway application code in `/prototype`, implemented independently of production `/web` and `/server`. Synthetic state lives in memory and resets on reload. No credentials, Rust server, cloud accounts, or database are used.

## Run

From the repository root, install dependencies once if needed:

```bash
npm --prefix prototype ci
```

Then start with one command:

```bash
npm --prefix prototype run dev
```

Open <http://127.0.0.1:4321/everyday/>. The original MVP 1 prototype remains at <http://127.0.0.1:4321/>.

Use **Continue with Google** to simulate owner sign-in. It makes no request to Google. Use only synthetic data: a reload, tab closure, or Reset demo discards your changes, history, and erasure records.

## Walkthroughs

1. **Shopping:** Open Groceries, check purchases, and mark purchased items needed again. Add/edit quantities and notes. Organize sections and items, including moving an item to another section. Check that status changes preserve manual positions.
2. **Travel:** In Checklists → Templates, open Camping packing. Start two named runs. Add Snow chains to one run; change a template item; inspect both runs to confirm independence.
3. **Cooking:** Start a Pasta dinner run, follow ingredients and preparation in place, finish with unchecked items after confirmation, and reopen. Archive a finished run, unarchive it, and confirm it stays finished until reopened.
4. **History and removal:** View a collection's history, trash an item, remove its former section, then restore the item from Trash. It should return to Unsectioned. Trash/restore a whole collection and check that previously trashed children stay trashed. Permanently erase a trashed item and inspect the parent history. Erase a template and confirm its existing runs remain.
5. **Reliability:** Expand **Review scenarios and simulated state**. Set **Next save** to failure, lost response, conflict, or session expiry, then make a change. Retry should not duplicate content or history. Conflicts retain your draft and require review of the latest saved version before a new save.
6. **Existing tasks:** Create, edit, complete, and reopen personal tasks. Inspect a sample task's migration baseline. Try discarding a draft, canceling that confirmation, and session expiry while editing.
7. **States and phone use:** Try cold start, unavailable, access denied, and empty lists. Use a narrow phone window and keyboard-only navigation. The state inspector shows both displayed and simulated saved state for comparison.

Scenario selection normally retains current synthetic data. **Empty lists** clears it; **Reset demo** restores the samples. Expire session preserves an editor draft in the same tab. An uncertain save must be retried or reviewed before another action; the draft remains visible but editing is paused until that save is resolved.

## Scope of the simulation

- All saves, identities, conflicts, delays, operation receipts, history, and erasure identifiers are local simulations. The inspector deliberately exposes synthetic state for review.
- Permanent erasure removes item/collection content and associated history from the in-memory state. Independent runs keep copied content. No real backups exist in this prototype; production erasure-aware recovery remains an implementation obligation.
- Browser storage is not used. Session expiry hides the application data, retaining an in-memory draft for simulated owner sign-in. This does not establish authentication or privacy guarantees.
- This prototype answers interaction questions. Production persistence, authorization, concurrency, migration, and backup guarantees require separate implementation and verification after approval.

The owner approved these prototype interactions. Production implementation is separate and must verify real persistence, authentication, concurrency, and recovery.

## Previews and verification

- [Desktop shopping](prototype-shopping-desktop.png)
- [Phone shopping](prototype-shopping-mobile.png)
- [Phone cooking](prototype-cooking-mobile.png)
- [History after changes](prototype-history.png)

Verified with Node 26.12.1 and local Chromium: shopping completion/reset with stable ordering; title/quantity validation; literal rendering of markup-like input; failure and lost-response retry without duplicate content/history; conflicting edits retaining a draft; independent template/run copies; run customization; finish/reopen/archive states; restoration after section removal; erasure of item content and parent history; template erasure preserving runs; task creation/completion; session draft recovery; modal Cancel focus and Escape; empty/loading/unavailable states; and no page overflow at 390px and 320px. No third-party or backend requests occurred. Desktop and phone screenshots were visually reviewed.

The checks above were a local exploratory browser walkthrough. They do not constitute production E2E coverage or prove real authentication, database atomicity, synchronization, or backup recovery. Production checks must exercise those real boundaries separately after prototype approval.

The static build passes, Astro check reports zero errors/warnings/hints, and formatting checks pass for the new prototype source. The existing MVP 1 prototype's three model tests and eight local-only browser tests also pass with the new route present.
