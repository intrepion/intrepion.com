# Pricing And Entitlements

This document defines the first draft of Intrepion's public plans and internal entitlement rules.

Prices are intentionally not final. The goal is to document product boundaries before implementing billing.

## Public Plans

| Plan | Intended User | Roadmaps | Tutorials | Support | Automation |
| --- | --- | --- | --- | --- | --- |
| Free | Curious individual | 1 static roadmap | View available public tutorials | Automated help and docs | None |
| Plus | Individual builder | 1 dynamic roadmap, 10 static roadmaps | View tutorials and request planned tutorials | Automated help and support requests | None at first |
| Pro | Serious solo operator | 10 dynamic roadmaps, 100 static roadmaps | View and request tutorials | Automated help, support requests, future AI support | Tutorial assistance when available |
| Business | Small team | 100 dynamic and 1000 static roadmaps | View and request tutorials | Priority human support during work hours | Tutorial services when available |
| Enterprise | Larger organization | Custom | Custom | Custom support terms | Custom integrations and rate limits |

## Definitions

Static roadmap:

A roadmap whose items are manually edited and do not automatically adapt based on user choices, integrations, or AI assistance.

Dynamic roadmap:

A roadmap that can adjust recommendations, tutorial suggestions, service steps, or next actions based on user choices, project context, plan level, or integrations.

Tutorial request:

A request from an eligible user asking admins to create or prioritize a missing tutorial.

Tutorial service:

An automation tied to a tutorial that can perform steps through third-party APIs after user confirmation.

AI-assisted roadmap draft:

A structured roadmap generated or revised by AI from user-provided project context. Drafts should be labeled as AI-assisted until reviewed or accepted by the user.

AI guide:

A user-facing assistant that answers from reviewed project, portfolio, tutorial, or support material. AI guides should not invent facts, pricing, availability, credentials, biography, professional claims, or commitments.

## Internal Free Access

The following users should be allowed to use paid-plan capabilities without payment:

- Oliver Forral.
- Karinna Forral.

Implementation note: this should eventually be represented as an internal comp, founder, admin, or manual entitlement record rather than hardcoded throughout the app.

## Role Rules

Users can have more than one role.

Oliver's account should be both:

- Admin.
- Regular user.

Admins can eventually:

- Manage users.
- Manage plans.
- Manage tutorials.
- Manage tutorial requests.
- Manage services.
- Review AI-generated tutorial drafts.
- Review AI-generated service drafts.

Admins should still be able to experience the app as regular users so internal projects can use the same roadmap workflow as customer projects.

## Support Rules

Initial support levels:

- Free: documentation and automated support flow.
- Plus: documentation, automated support flow, and tutorial requests.
- Pro: Plus support plus future AI support.
- Business: Pro support plus priority human support during published work hours.
- Enterprise: custom terms.

Avoid using the phrase "live chat" in public copy until a real staffing and response-time policy exists.

## Billing Rules

Billing should not be implemented until the plan rules are reviewed.

When billing is added:

- Family/internal accounts should not be charged.
- Other users should require payment for paid plans.
- Failed payment should downgrade or restrict paid entitlements without deleting user data.
- Plan changes should be auditable.
- Enterprise should support manual billing outside self-serve checkout.

## Seat Rules

Business and Enterprise plans will eventually support teams.

Draft assumptions:

- Team management starts on Business.
- Seat billing starts on Business.
- Bulk discounts can be introduced at documented thresholds.
- Enterprise can negotiate custom seat terms.

Do not implement seat billing until individual plan billing is working.

## API Access Rules

Business and Enterprise users may eventually buy increased API limits.

Draft assumptions:

- Default public API access is not part of the first MVP.
- Higher rate limits should cost more.
- API access should have separate keys, logs, and revocation from user login.
- Enterprise can negotiate custom limits.

## Automation Safety

Tutorial services may create, update, or configure external resources. These operations can have security or billing consequences.

Required rules before automation is released:

- Users must explicitly connect credentials.
- Users must explicitly confirm sensitive actions.
- Service actions must be logged.
- Destructive actions require extra confirmation.
- AI-generated service actions require admin review before publication.
- Users must be able to revoke credentials.

## AI Safety

AI should enter the product as structured roadmap assistance before generic chat.

Allowed early uses:

- Drafting six-horizon roadmaps from user-provided goals.
- Identifying missing tutorials or unclear assumptions.
- Suggesting which roadmap items might become services later.
- Answering questions from reviewed project, portfolio, or tutorial material.

Not allowed without explicit review:

- Publishing AI-generated tutorials publicly.
- Executing AI-generated service actions.
- Inventing user credentials, experience, biography, artwork meaning, pricing, availability, or business commitments.
- Presenting an AI assistant as a person without clear boundaries.

Owned-project examples:

- Oliver's future AI avatar should answer from reviewed professional material and should not invent experience or make commitments to employers or clients.
- Karinna's future studio guide should answer from artist-approved material and should not replace the artist's authorship, interpretation, pricing decisions, or availability decisions.

## Open Questions

- What are the actual monthly prices for Plus, Pro, and Business?
- Should static public roadmaps count differently from private static roadmaps?
- Should tutorial requests be limited per month?
- Should Pro include any human support or only AI-assisted support?
- What are the published Business support hours?
- Should Enterprise require annual contracts only?
- Which payment provider should be used first?
- Which auth provider should be used first?
