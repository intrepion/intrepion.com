# MVP 2 design review

Status: **scope approved in Q41; wireframes, visual mockups, and standalone prototype approved by the owner; production implementation in progress**.

The [visual mockup gallery](mockups.html) and [review notes with desktop and phone previews](MOCKUPS.md) record the approved design. The [standalone prototype run instructions](../../prototype/README.md) cover the next approval gate. The approved wireframes remain available below.

Try the [MVP 2 prototype walkthrough](PROTOTYPE.md), with [phone shopping](prototype-shopping-mobile.png), [phone cooking](prototype-cooking-mobile.png), and [desktop shopping](prototype-shopping-desktop.png) previews.

Open [the wireframe gallery](wireframes.html) directly in a browser. It requires no server or dependencies. All examples are synthetic, and the illustrated controls are static. The index links navigate between screens.

```bash
xdg-open design/mvp-2/wireframes.html
```

Review structure, action placement, and transitions at this stage. Visual styling follows wireframe approval, and interactive behavior follows mockup approval in the separate local prototype.

## Review order

| Workflow                                                   | Panels |
| ---------------------------------------------------------- | ------ |
| Shopping lists, repeated purchases, phone use              | 01–03  |
| Collection/item forms and validation                       | 04, 22 |
| Template selection, cooking structure, run creation        | 05–07  |
| Active/finished runs, customization, phone use             | 08–11  |
| Section operations and ordering without dragging           | 12     |
| Existing personal tasks                                    | 13     |
| History, Archive, Trash, restoration                       | 14–16  |
| Archive, Trash, bulk-reset and erasure confirmations       | 17–18  |
| Empty, loading, failure, conflict, expiry and draft states | 19–22  |

For a shorter review, follow Shopping (01–04), Cooking (05–11), then Recovery (14–18). Travel uses the same checklist workflow with packing sections instead of ingredients and preparation.

## Previews

- [Desktop gallery preview](wireframes-desktop.png)
- [Phone shopping layout](wireframes-shopping-mobile.png)
- [Phone cooking layout](wireframes-cooking-mobile.png)

## Design boundaries

- Source of truth: [accepted MVP 2 decisions and acceptance scenarios](../../docs/mvp-2-plan.md).
- Preserve owner-only Google access and existing Tasks behavior, with the accepted change from permanent deletion to Trash.
- Keep Archive, Trash, and Finished distinct. Archived/trashed content is read-only; finished runs require reopening to edit.
- Template edits affect future runs; existing runs retain independent copies.
- Explain permanent-erasure scope, including parent history and independent copied runs.
- Do not present pending changes as saved. Conflict handling preserves drafts; retry must not duplicate operations.
- Google sign-in/access denial follows the existing MVP 1 flow. Household roles, AI, other clients, themes, offline editing, search, and advanced filters are outside this review.

## Validation

Checked all 22 panels in headless Chromium at viewport widths of 1440, 390, and 320 pixels: no horizontal document or panel overflow, no broken index anchors, and no page script errors. The document contains no scripts or external assets. Desktop and shopping-phone previews were visually inspected.

These checks validate the static document only. Keyboard interactions, focus, announcements, touch targets, state transitions, and failure recovery must be exercised in the later prototype and production work.

All design gates are approved. Production implementation and verification are in progress.
