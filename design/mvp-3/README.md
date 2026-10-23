# MVP 3 wireframe review

Status: **scope confirmed in Q56; wireframes and visual mockups approved by the owner; standalone prototype approved; production implementation in progress**. Production implementation and launch are later gates.

Review the [standalone prototype walkthrough](PROTOTYPE.md) for the current gate. The [visual mockup gallery](mockups.html) and [mockup review guide](MOCKUPS.md) record the approved appearance. The approved wireframes remain below.

Open [the 23-screen wireframe gallery](wireframes.html) directly in a browser. No API, development server, dependencies or network access are needed. The gallery index links navigate between static screens; the illustrated application controls do not execute actions.

```bash
xdg-open design/mvp-3/wireframes.html
```

All people, content, dates and numerical allowances are illustrative. These examples do not approve numerical pilot caps. The accepted scope is in [the MVP 3 plan](../../docs/mvp-3-plan.md).

## Review route

| Workflow                                                             | Panels |
| -------------------------------------------------------------------- | ------ |
| Private/shared space identity, everyday lists and household creation | 01–03  |
| Invitations, acceptance and invitation failures                      | 04–06  |
| Equal head authority and control of your own ceilings                | 07–08  |
| Private plan overview, allocation preview and rejected withdrawal    | 09–11  |
| Visible usage, full storage and independent sharing copies           | 12–14  |
| Actor History and administrative activity                            | 15     |
| Removal, departure and irreversible final closure                    | 16–18  |
| Former contributors, scheduled erasure and failed erasure            | 19–20  |
| Loading, conflicts, quota races, access loss and session recovery    | 21     |
| Phone shopping and capacity layouts                                  | 22–23  |

Review whether the selected space is always clear, whether sharing and invitation consequences are understandable, and whether departure distinguishes access loss from retained capacity. Check that controls never suggest editing another head's ceiling or subscription. Final closure must clearly show the scheduled erasure deadline and lack of reopening.

## Previews

- [Desktop gallery](wireframes-desktop.png)
- [Phone shopping](wireframes-mobile.png)
- [Last-head closure on a phone](wireframes-close.png)

## Boundaries

Existing MVP 2 item forms, sections, templates/runs, Archive, Trash and content-history workflows remain the baseline within each space. These wireframes focus on the new household and quota behavior. The later mockups and prototype must carry those existing workflows forward rather than replace them with an incomplete shopping-only application.

The prototype must be separate from production and run locally without the Rust server. No mockup or prototype approval is implied by scope or wireframe approval. Pilot numerical limits require a later explicit review informed by retained usage and backup export overhead.

No ordinary member/dependent roles, PIN controls, Categories, named task-list containers, billing, real-time collaboration or operator web dashboard are introduced.

## Validation

Headless Chromium checked all 23 screens at 1440, 390 and 320 pixel viewport widths: no document or panel horizontal overflow, broken index targets, unresolved template placeholders, page script errors or external requests. The gallery has no scripts or external assets. Phone shopping and last-head closure previews were visually inspected.

These are static-document checks. Functional keyboard and focus behavior, accessible announcements, actual authentication, persistence, conflict handling, quota enforcement and erasure/recovery require the later prototype and production verification.
