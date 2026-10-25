# MVP 3.1 visual mockups

Status: **wireframes and visual mockups approved by the owner; standalone prototype approved; production implementation in progress**. Review the [interactive prototype guide](PROTOTYPE.md). Production implementation follows prototype approval.

## Review

Open the [28-screen gallery](mockups.html) directly:

```sh
xdg-open design/mvp-3-1/mockups.html
```

Focused views make it easier to review individual screens:

| Screen                               | HTML                           | Preview                                                                |
| ------------------------------------ | ------------------------------ | ---------------------------------------------------------------------- |
| Persistent Households directory      | [Open](mockup-households.html) | [Desktop](mockup-households-desktop.png)                               |
| New account and household acceptance | [Open](mockup-invitation.html) | [Phone](mockup-invitation-mobile.png)                                  |
| Owner administration                 | [Open](mockup-admin.html)      | [Desktop](mockup-admin-desktop.png) · [Phone](mockup-admin-mobile.png) |
| Recipient invitation email           | [Open](mockup-email.html)      | [Phone](mockup-email-mobile.png)                                       |

All documents are self-contained and open without a server, credentials or network. Buttons are disabled presentation controls; fields are read-only illustrations. Gallery links navigate. The actual display-name field will be editable in the later prototype. Names, email addresses, counts and measurements are synthetic; this work creates no accounts, sends no mail and changes no production behavior.

## Appearance for approval

- Extend the existing light canvas, white surfaces, deep green text, teal actions, rounded cards and system fonts. Theme selection remains deferred.
- Keep the selected space visible above navigation. Households has a persistent entry; Admin appears only in owner examples. A household head has no site-wide administration authority.
- Use a solid teal primary action for explicit acceptance and form progression. Red identifies destructive account actions; amber draws attention to recoverable interruptions and paused operations. Warnings explain the consequence in words as well as color.
- Keep a clear boundary between verified Google email and the editable display name. Before accepting, explain equal-head authority, access to earlier retained household History and personal-space privacy.
- Show delivery state without exposing invitation links. Do not present “delivered to receiving mail server” as proof of reading or inbox placement. The email preview includes expiry, equal authority and an expected support route; actual sender/support addresses remain setup inputs.
- Replace ordinary-user capacity controls with the approved name-only creation flow. Unsaved-change feedback preserves drafts and provides a support route without disclosing numeric safety limits.
- Use metadata cards and detailed review views for the owner. Numbers, units, freshness and unknown measurements remain explicit. The email budget bar has adjacent text; it is an application attempt budget, not a guaranteed invoice ceiling. Review flags do not automatically suspend accounts.
- Give controls at least 44px height, persistent field labels, wrapping navigation/actions and stacked facts/cards on narrow screens.

## Scope and gates

All 28 panels map to the [approved wireframes](wireframes.html) and [confirmed scope](../../docs/mvp-3-1-plan.md). This styling pass adds no resource caps, billing, public registration, dependent roles or PIN access. Existing Everyday lists, Sections, templates/runs, Archive, Trash, content History and protected household closure remain the behavioral baseline.

The design renderer is separate from prototype and application builds. Do not promote its HTML or renderer into production. The next gate is a separate interactive prototype that runs locally without the Rust server; its simulations will not contact Google or SES. Backend enforcement, AWS setup, actual thresholds and live rollout require their later verification/review gates.

## Validation

Local Chromium checks passed for the gallery and all four focused views at 1440, 390 and 320 pixels: no document/panel overflow, duplicate IDs, broken anchors/doc links, empty screen headings, unlabeled fields, page errors or external requests. All buttons are disabled and all inputs read-only; controls are at least 44px tall. Ordinary-account examples omit Admin navigation. Desktop directory/owner and phone acceptance/owner/email previews were visually inspected. Prettier and whitespace checks passed.

Calculated contrast for the specified palette:

| Pair                          | Ratio   |
| ----------------------------- | ------- |
| Body on white                 | 13.95:1 |
| Secondary on white            | 5.65:1  |
| White on primary              | 7.60:1  |
| White on destructive action   | 6.90:1  |
| Warning on amber surface      | 6.55:1  |
| Danger on soft red surface    | 6.31:1  |
| Field outline on white        | 3.43:1  |
| Primary on soft green surface | 6.72:1  |

These checks validate static layout and palette pairs, not full accessibility or working application behavior. Keyboard/focus transitions, announcements, actual Google authentication, email delivery, concurrent acceptance/revocation and protected recovery require later functional checks.

## Rebuild

```sh
node design/mvp-3-1/render-mockups.mjs
```

The design-only renderer reads the approved wireframe panels and local CSS, then writes five standalone documents with embedded styles and an inline vector brand mark. It performs no network requests. Run Prettier on the generated HTML after rebuilding.
