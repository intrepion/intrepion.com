# Consent-based invitation mockups

The owner approved the [scope](../../docs/mvp-3-1-consent-plan.md), [wireframes](wireframes.html), these visual mockups, and the interactive standalone [prototype](PROTOTYPE.md). Prototype code remains separate from production.

Open the 35-screen [mockup gallery](mockups.html) directly, with no server:

```sh
xdg-open design/mvp-3-1-consent/mockups.html
```

These are static visual designs with synthetic names, addresses and dates. Buttons are disabled. They do not send email, sign in, save settings or access the network.

Review routes:

- **1–5:** head creates and shares a request link, manages links and confirms revocation.
- **6–14:** visitor signs in, explicitly requests email, handles unavailable links and withdraws.
- **15–23:** head opts into notifications, reviews requests, and sees approval, decline and failure states.
- **24–30:** recipient email, wrong-account recovery, explicit acceptance, notification controls and paused growth.
- **31–35:** owner administration, recovery, History, link-creator departure and the consent deadline.

Previews: [request on mobile](mockup-request-mobile.png), [head review on mobile](mockup-head-review-mobile.png), [notification email on mobile](mockup-notification-mobile.png), and [owner administration on desktop](mockup-admin-desktop.png).

Local Chromium checks passed for all 35 panels: unique IDs, internal navigation, disabled buttons, no scripts or external requests, and no horizontal page overflow at 1440, 390 and 320 pixels. The request, review, notification email and administration previews were visually inspected. These checks establish presentation only; behavior and persistence require the later prototype and implementation checks.
