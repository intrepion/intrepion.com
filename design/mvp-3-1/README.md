# MVP 3.1 design review

The owner confirmed the [scope](../../docs/mvp-3-1-plan.md) at Q24. **Wireframes and visual mockups are approved; the standalone prototype is approved; production implementation is in progress.** Review the [mockup guide](MOCKUPS.md) and [28-screen visual gallery](mockups.html). Review the [interactive prototype guide](PROTOTYPE.md). Production implementation follows prototype approval as a separate step.

## Open the wireframes

Open [wireframes.html](wireframes.html) directly in a browser:

```sh
xdg-open design/mvp-3-1/wireframes.html
```

No server, network connection, credentials or additional dependencies are needed. These are static layout illustrations: application buttons are disabled and fields are read-only. The numbered index navigates between screens. Names, addresses and measurements are synthetic.

## Suggested review routes

- Screens 1–5: Google sign-in, the persistent Households directory, name-only creation, emailed invitations and delivery management.
- Screens 6–15: recipient email, private landing, wrong-account recovery, new/existing account acceptance, success, unavailable links, paused growth, Send again and inviter departure.
- Screens 16–18: equal-head management, general unsaved-change feedback and interrupted-session recovery.
- Screens 19–24: owner-only metadata overview, account details, hidden safety thresholds, confirmation, growth pause and suspension/restoration.
- Screens 25–28: sending budget, delivery feedback/suppression, retention and protected recovery.

Check whether the recipient understands the equal-head authority and access to earlier household History before joining; whether the simpler household screens have enough guidance; and whether the owner overview exposes the information needed to investigate unusual usage without revealing private list contents.

The ordinary account screens omit capacity meters, contribution sliders and head ceilings. Exact backend resource thresholds remain a sizing/approval decision; the wireframes introduce no numerical resource caps. The email budget and retention periods reflect the confirmed scope. Application sending controls do not guarantee an AWS invoice ceiling.

## Previews and validation

- [Desktop overview](wireframes-desktop.png)
- [Mobile account creation and acceptance](wireframes-join-mobile.png)
- [Owner administration overview](wireframes-admin.png)

Local Chromium checks passed for all 28 panels: unique IDs, valid internal navigation, no scripts or HTTP requests, disabled application buttons, and no horizontal overflow at 1440, 390 and 320 pixels. Mobile acceptance and owner overview screenshots were visually inspected. Prettier and whitespace checks also passed.

These checks validate static presentation only. Authentication, email delivery, persistence, privacy enforcement and recovery will need functional verification during implementation. No AWS resources or application behavior were changed for this design review.
