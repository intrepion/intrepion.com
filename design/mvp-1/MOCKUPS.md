# MVP 1 visual mockups

Status: **approved by the owner in Q36**. Wireframe layouts and workflows were approved in Q35. The approved visuals are being implemented separately in the local Astro prototype; production UI has not begun. Themes were suggested for a later MVP and are outside the current design.

## Review artifacts

- [Full gallery: all 17 screens and states](mockups.html)
- [Desktop task list](mockup-desktop.png) / [standalone HTML](mockup-desktop.html)
- [Mobile task list](mockup-mobile.png) / [standalone HTML](mockup-mobile.html)
- [Desktop edit form](mockup-form.png) / [standalone HTML](mockup-form.html)
- [Mobile edit form](mockup-mobile-form.png) / [standalone HTML](mockup-mobile-form.html)
- [Confirmation and error states](mockup-states.html)

All HTML files are standalone, use embedded CSS and the local Google mark, and open directly without a server. Controls are presentation-only. Nothing signs in, mutates a task, saves data, or calls a network service.

## Visual choices for approval

- Light canvas `#f4f5f1`, white surfaces, dark green text `#1b302c`, secondary text `#596b65`, deep teal primary actions `#185e52`, and restrained red destructive/error treatment `#a52f2b`.
- System fonts; 30 px desktop titles and 27–28 px mobile titles. Task text remains prominent; supporting labels use 12–14 px text.
- A 4 px spacing rhythm, 8–9 px control corners, 18 px surface corners, and a visible 3 px focus outline.
- At least 44 px tall primary and row-action hit areas. Checkbox targets are 44 × 44 px, with a smaller visible mark inside.
- The approved dedicated forms, visible Completed section, Edit/Delete actions, permanent-delete confirmation, and unsaved-draft confirmation remain intact.
- Pending updates retain the last confirmed state. Save failures keep the draft; validation uses text and an icon as well as color. These are drawn states, not implemented interactions.

The small intrepion wordmark and check symbol are a proposed visual treatment for this MVP, not a separate identity-design project. The Google mark is the official asset; [provenance and production-button boundary](assets/README.md).

## Visual verification

Rendered and inspected in Chromium at 1440 × 1020 for desktop and 390 × 844 for mobile. The gallery includes sign-in/access denial, empty/populated lists, forms, pending changes, validation, unavailable-list, retained-draft, and confirmation states. No browser E2E or application tests are appropriate for these static design artifacts; interaction validation follows in the prototype.

Calculated contrast ratios:

| Pair | Ratio |
| --- | --- |
| Body text on white | 13.95:1 |
| Secondary text on white | 5.65:1 |
| White on primary action | 7.60:1 |
| White on destructive action | 6.90:1 |
| Error text on error background | 7.77:1 |
| Secondary text on canvas | 5.16:1 |

These measurements cover the specified palette, not full accessibility conformance. Focus order/restoration, screen-reader announcements, keyboard operation, animation preferences, and actual touch interaction require the interactive prototype.

## Rebuild

```sh
node design/mvp-1/render-mockups.mjs
```

The generator reads `mockups.css` and the official Google image and emits static HTML. It belongs to the design review; do not import it into the Astro prototype or production app. Implement the accepted visual specification separately at each later stage.
