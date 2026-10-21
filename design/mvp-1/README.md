# MVP 1 design review

Status: **wireframes approved in Q35; visual mockups approved in Q36; interactive prototype approved in Q37**. Open the [prototype run instructions](../../prototype/README.md), [desktop screenshot](prototype-desktop.png), and [mobile screenshot](prototype-mobile.png). The [mockup gallery](mockups.html), [visual review notes](MOCKUPS.md), approved [wireframes](wireframes.html), and their [rendered overview](wireframes-overview.png) remain available.

This review covers the agreed personal task workflow, with Google login and no public registration. The wireframes are grayscale structural drawings; the buttons and fields are intentionally static. They are not the Astro prototype and do not share production application code.

| Workflow | Screens |
| --- | --- |
| Google sign-in, cancellation, sign-out, session expiry | 01, 02, 08, 10 |
| Owner-only access denial | 02 |
| First task / empty list | 03, 05 |
| List, complete, reopen | 04, 11 |
| Create and validate | 05, 09 |
| Edit, cancel, discard unsaved changes | 06, 09, 12 |
| Permanent delete confirmation and failure | 07 |
| Cold start, unavailable list, failed mutation | 08, 09, 10 |
| Responsive list and form | 11, 12 |

The owner approved a dedicated form view instead of a side drawer, an always-visible Completed section, explicit Edit/Delete actions, and confirmation before discarding an unsaved draft. Task order, field limits, permanent deletion, Google-only login, and confirmation before showing a successful save come from the agreed plan.

Use keyboard-accessible controls, labeled fields, focus management, and clear error announcements in the later prototype and production implementation. Those interactions cannot be validated by this static document. No future-project navigation, AI controls, alternate login methods, sharing, or offline-editing controls are included.

Visual mockups are approved. The separate Astro `/prototype` now implements synthetic interactive behavior for the next review; production UI follows approval of that prototype.
