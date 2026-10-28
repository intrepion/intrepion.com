# Consent-based invitations: wireframe review

The owner approved the [consent amendment scope](../../docs/mvp-3-1-consent-plan.md), wireframes, [visual mockups](MOCKUPS.md), and standalone [prototype](PROTOTYPE.md). Production implementation follows separately.

Open the 35-screen [wireframe gallery](wireframes.html) directly, without a server:

```sh
xdg-open design/mvp-3-1-consent/wireframes.html
```

The buttons are intentionally disabled. Names, addresses and dates are synthetic; the page sends no email and changes no data. Use the numbered index to move between screens.

Suggested review routes:

- **1–5:** a head creates, shares and revokes a reusable request link.
- **6–14:** a visitor signs in, explicitly requests mail, checks their own requests or withdraws.
- **15–23:** head notification preferences, request review, approval, declines, sending limits and concurrent changes.
- **24–30:** recipient email and explicit acceptance; unavailable, notification and growth-pause states.
- **31–35:** owner operational view, recovery, retained History, creator departure and the 30-day sending window.

Mobile previews: [recipient request](request-mobile.png) and [head review](head-review-mobile.png). Chromium checks covered all 35 panels, internal navigation, disabled buttons, no scripts or external requests, and viewport widths of 1440, 390 and 320 pixels. The recipient mobile view was visually inspected. These checks validate presentation only; functional and provider behavior remain implementation work.
