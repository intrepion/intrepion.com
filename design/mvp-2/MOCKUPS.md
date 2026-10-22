# MVP 2 visual mockups

Status: **wireframes and visual mockups approved by the owner; standalone prototype follows**.

## Review artifacts

- [Full gallery: all 22 panels](mockups.html)
- [Desktop shopping](mockup-shopping.html) / [image](mockup-shopping-desktop.png)
- [Phone shopping](mockup-shopping-mobile.html) / [image](mockup-shopping-mobile.png)
- [Cooking template](mockup-template.html)
- [Desktop cooking run](mockup-run.html) / [image](mockup-run-desktop.png)
- [Phone cooking run](mockup-run-mobile.html) / [image](mockup-run-mobile.png)
- [Phone item form](mockup-form-mobile.html) / [image](mockup-form-mobile.png)
- [History, Archive, Trash, erasure, and conflicts](mockup-recovery.html) / [image](mockup-recovery.png)
- [Finish, Trash, Archive, and section-removal confirmations](mockup-confirmations.html) / [image](mockup-confirmations.png)

Open any HTML directly in a browser; no server is needed:

```bash
xdg-open design/mvp-2/mockups.html
```

All content is synthetic. These are static design documents, with presentation-only controls and no scripts, login, persistence, or external requests. Input values are read-only examples. Prototype and production application code will be implemented separately.

## Visual decisions for review

- Retain MVP 1's light canvas, white surfaces, dark green text, deep teal actions, and system fonts. This extends the existing design; theme selection remains deferred.
- Use clear Tasks / Shopping / Checklists navigation, with Templates / Runs and Active / Finished views inside Checklists. Archive and Trash remain separate footer destinations.
- Give titles and list contents priority. Show quantities and notes beneath item titles. Shopping purchases receive checked and struck-through treatment; checked cooking steps keep their positions and readable titles.
- Use progress text plus a narrow teal progress bar on runs. Finished and Archived states explicitly say read-only; Trash exposes restoration and erasure instead of editing.
- Primary actions use solid teal; destructive permanent erasure uses solid red. Ordinary Move to Trash stays a reversible action. Confirmations describe scope and recovery in words, rather than relying on color.
- Use a 44px minimum control height, with 44 × 44px checkbox targets. Item actions wrap below text on narrow screens. Explicit buttons make organizing usable without dragging.
- Forms use persistent labels, visible limits, and inline error messages. Conflicts show the retained draft beside the latest saved value on desktop, stacking on phones; there is no blind-overwrite action.
- Permanent-erasure dialogs explain child content/history scope and that independent runs keep copied content. Cancel receives initial focus in the later implementation.

## Relationship to approved wireframes

The gallery follows the same 22-panel workflow coverage as [the approved wireframes](wireframes.html). The separate confirmation gallery expands the already-approved finish, Trash, Archive, and section-removal confirmations. Item and collection forms share the same visual pattern. Travel uses the checklist system illustrated by cooking and the packing-template examples.

The product behavior remains defined in [the accepted MVP 2 plan](../../docs/mvp-2-plan.md). These visual documents do not add households, search, offline editing, recipe calculations, themes, AI, or new authentication methods.

## Validation

All nine documents were checked in Chromium at widths of 1440, 390, and 320 pixels. No horizontal document/panel overflow, broken index anchors, duplicate IDs, script errors, or controls below 44px tall were found. No external requests were made. Desktop shopping, phone shopping/cooking/forms, and confirmation previews were visually inspected. Local review-document links were checked after the guide was written.

Calculated palette contrast:

| Pair                              | Ratio   |
| --------------------------------- | ------- |
| Body text on white                | 13.95:1 |
| Secondary text on white           | 5.65:1  |
| White on primary                  | 7.60:1  |
| White on permanent-erasure action | 6.90:1  |
| Error text on error surface       | 7.77:1  |
| Control outline on white          | 3.43:1  |
| Primary text on soft surface      | 6.72:1  |

These checks cover the static document and specified palette, not full accessibility conformance. Focus order/restoration, screen-reader announcements, keyboard operation, real touch use, and recovery transitions require the standalone prototype. Application tests and cloud access are unnecessary for this design-only change.

## Rebuild

```bash
node design/mvp-2/render-mockups.mjs
```

The generator reads `mockups.css` and emits nine standalone HTML documents with embedded CSS and inline vector symbols. It belongs only to this design review. Do not import this generator or its UI code into the prototype or production app.

The owner approved the standalone, server-free local prototype. Production implementation is in progress.
