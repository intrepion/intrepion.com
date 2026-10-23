# MVP 3 visual mockups

Status: **wireframes and visual mockups approved by the owner; standalone prototype approved; production implementation in progress**. Review [the interactive prototype and walkthrough](PROTOTYPE.md) for the current gate.

## Review artifacts

- [All 23 screens](mockups.html)
- [Household shopping and head administration](mockup-household.html) · [desktop preview](mockup-household-desktop.png)
- [Private plan, allocation review, blocked withdrawal and household usage](mockup-capacity.html) · [allocation preview](mockup-capacity-desktop.png)
- [Phone shopping and own ceilings/capacity](mockup-mobile.html) · [shopping image](mockup-mobile.png) · [capacity image](mockup-mobile-capacity.png)
- [Removal, departure, final closure and retained allocations](mockup-closure.html) · [phone closure preview](mockup-closure-mobile.png)

Open directly, with no application server or dependencies:

```bash
xdg-open design/mvp-3/mockups.html
```

Application controls are presentation only and fields are read-only examples. Gallery links navigate. All people, content, dates and numerical allowances are illustrative. No scripts, login, persistence or external resources are included.

## Visual decisions for review

- Extend the existing app's light canvas, white surfaces, dark green text, deep teal actions and system fonts. Theme selection remains deferred.
- Keep the current space above navigation, with explicit Private or Shared · Head status. Household usage belongs in the shared space; private plan remainders belong only in My capacity.
- Use solid teal for primary actions, soft teal for secondary navigation, and explicit red treatment for removal/departure warnings. The final closure confirmation uses a solid red action and states that reopening is unavailable.
- Show used/allowed text alongside capacity bars. Member ceilings, contributed capacity and household totals remain distinct; storage is shared per space. Numerical examples do not authorize launch caps or paid plans.
- Show independent resource fields rather than an allocation percentage slider. Allocation reviews identify source-space effects; changes that would leave retained usage without capacity are blocked.
- Give controls and shopping checkbox targets at least 44px height. Use persistent form labels, wrapping actions and stacked rows on narrow phones. Purchased shopping titles are checked and struck through, retaining quantities and actor text.
- Other heads' ceilings are read-only. Each head's own controls remain separate from removal controls. Joining and invitations explain full access to existing household content and History.
- Closure explains both immediate access loss and the precise future UTC/local erasure deadline. Former heads retain only the allocation management and eligibility view; failure states never imply that reserved capacity has already been released.

## Relationship to approved scope

All 23 panels map to the [approved wireframes](wireframes.html), which remain the workflow baseline alongside [the confirmed MVP 3 scope](../../docs/mvp-3-plan.md). The renderer reuses their static review content while applying visual hierarchy and presentation. Existing Everyday lists forms, Sections, templates/runs, Archive, Trash and History remain in scope inside each space.

The images and HTML are design artifacts. Do not import their renderer or UI code into the standalone prototype or production app. The prototype must run locally without the Rust server and requires separate approval before production implementation. Other clients, billing, Categories, non-head roles and instant collaboration remain deferred.

## Validation

All five documents passed headless Chromium checks at 1440, 390 and 320 pixel viewport widths: no horizontal document/panel overflow, duplicate IDs, broken gallery anchors, missing linked documents, unresolved template placeholders, empty screen headings, script errors or external requests. Application buttons and read-only fields are at least 44px tall and fields have labels. Shopping checkbox targets are 44 × 44px. Desktop shopping/allocation and phone shopping/closure previews were visually inspected; phone shopping and allocation were reinspected after control refinements.

Calculated palette contrast:

| Pair                            | Ratio   |
| ------------------------------- | ------- |
| Body on white                   | 13.95:1 |
| Secondary on white              | 5.65:1  |
| White on primary                | 7.60:1  |
| White on destructive action     | 6.90:1  |
| Warning text on warning surface | 8.04:1  |
| Control outline on white        | 3.43:1  |
| Primary text on soft surface    | 6.72:1  |

These checks cover static layout and the specified palette, not full accessibility conformance or working application behavior. Focus management, keyboard use, announcements, real touch use and state transitions must be exercised in the later prototype. Authentication, authorization, atomic quota checks, persistence, erasure and recovery need production verification.

## Rebuild

```bash
node design/mvp-3/render-mockups.mjs
```

The design-only renderer reads the approved wireframe panels and `mockups.css`, then emits five standalone HTML documents with embedded styles and inline vector marks. It performs no network calls and is separate from production builds.

## Approved storage-recovery amendment

The owner approved explicit permanent erasure of selected active content when full storage prevents adding Trash History. The full-storage wireframe and mockup now show the existing scope-confirmation pattern for this entry point. In the standalone prototype, simulate full storage, open a task or collection, and choose **Erase permanently · storage recovery**. Cancel keeps the content; confirmation removes the selected target and associated child content/History, leaves independent copies alone, and simulates recovery protection before freeing capacity. Normal Trash behavior is unchanged.
