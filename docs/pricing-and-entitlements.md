# Pricing And Entitlements

This document defines the first draft of Intrepion's plan and entitlement rules for the AI-assisted life roadmap vision.

Prices are intentionally not final. The goal is to document product boundaries before implementing billing.

## Public Plans

| Plan | Intended User | Life Areas | Records | AI Assistance | Automation |
| --- | --- | --- | --- | --- | --- |
| Free | Curious individual | 1 life area | Limited manual records | Limited roadmap drafts | None |
| Plus | Individual user | 3 life areas | More manual records and uploads | Regular roadmap and review help | None at first |
| Pro | Power user | Unlimited personal life areas | Higher record and upload limits | Deeper AI summaries and drafts | Early assisted workflows |
| Life | Serious personal operating system user | Unlimited personal life areas | High limits, richer history, stronger search | Cross-area AI reviews | Selected confirmed automations |
| Family | Household or couple | Shared and private life areas | Shared household records | Household-aware reviews | Selected confirmed automations |

## Definitions

Life area:

A major domain the user wants to manage, such as ambitions, career, relationships, food, language learning, fitness, travel, entertainment, shopping, receipts, or finances.

Static roadmap:

A roadmap whose items are manually edited and do not automatically adapt based on records, reviews, or AI assistance.

Dynamic roadmap:

A roadmap that can adjust recommendations, review prompts, missing information, or next actions based on records, user choices, AI summaries, and life-area context.

Record:

A stored fact or artifact attached to a life area. Records may include portfolio assets, project notes, domains, receipts, job applications, watched videos, people notes, restaurant ratings, recipes, workouts, trips, debts, bills, coupon codes, language notes, and uploaded files.

AI-assisted roadmap draft:

A structured roadmap generated or revised by AI from user-provided context and records. Drafts should be labeled as AI-assisted until reviewed or accepted by the user.

Review:

A recurring check-in that turns records, roadmap status, and user intent into next actions.

Service:

An optional automation that performs an external action after explicit user confirmation.

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
- Manage public documentation.
- Review AI-generated templates.
- Review AI-generated service ideas.
- Review safety rules for sensitive life areas.

Admins should still be able to experience the app as regular users so internal life areas use the same workflow as customer life areas.

## Entitlement Areas

Plan limits may eventually include:

- Number of life areas.
- Number of records.
- Upload storage.
- Receipt/photo extraction volume.
- AI draft and review volume.
- Search history depth.
- Cross-area review access.
- Export and backup options.
- Automation access.
- Household sharing.

Do not implement billing until the plan rules are reviewed.

## Sensitive Areas

Sensitive areas require careful product boundaries:

- Finances, credit cards, debt, bills, and bank-like data.
- Job applications, resumes, salary information, and employment history.
- Fitness routines, body goals, recovery notes, and injury-related context.
- Travel documents, itineraries, location history, and identity documents.
- Private notes about other people, relationship history, contact details, and planned follow-ups.
- Food preferences, allergies, dietary restrictions, restaurant history, grocery habits, and location history.
- Receipts, purchases, store accounts, coupons, and discounts.
- Credentials, API keys, OAuth tokens, and uploaded documents.
- Private entertainment history or learning notes if the user marks them private.

## AI Safety

AI should enter the product as structured roadmap, record, and review assistance before generic chat.

Allowed early uses:

- Drafting six-horizon roadmaps from user-provided goals.
- Summarizing manually entered records.
- Identifying missing information and unclear assumptions.
- Suggesting next actions.
- Drafting job materials from reviewed professional material.
- Generating language practice from target languages, user goals, known weak spots, and recent review history.
- Drafting fitness routines from user goals and logged history without medical claims.
- Summarizing travel plans, packing needs, bookings, budgets, and missing documents.
- Suggesting thoughtful follow-ups from user-approved relationship notes.
- Summarizing restaurants, recipes, grocery notes, wait times, parking, prices, and repeat-worthy meals.
- Extracting receipt fields from uploaded receipt images after the user confirms the result.

Not allowed without explicit review or confirmation:

- Giving professional financial advice.
- Giving medical advice or treating injuries.
- Manipulating relationships or pretending to know another person's feelings.
- Giving medical or nutrition advice from food records.
- Making payments or purchases.
- Applying to jobs.
- Sending messages to employers, stores, banks, or services.
- Executing AI-generated service actions.
- Inventing credentials, employment history, artwork meaning, pricing, availability, biography, financial facts, or commitments.
- Deleting records or source files.

## Automation Safety

Services may eventually create, update, or configure external resources. These operations can have security, billing, employment, or financial consequences.

Required rules before automation is released:

- Users must explicitly connect credentials.
- Users must explicitly confirm sensitive actions.
- Service actions must be logged.
- Destructive actions require extra confirmation.
- AI-generated service actions require admin review before publication.
- Users must be able to revoke credentials.
- Users must be able to export or back up important records.

## Support Rules

Initial support levels:

- Free: documentation and automated support flow.
- Plus: documentation, automated support flow, and support requests.
- Pro: Plus support plus higher AI usage.
- Life: Pro support plus higher limits and selected assisted workflows.
- Family: shared support for household setup.

Avoid promising live chat until there is a real staffing and response-time policy behind it.

## Billing Rules

Billing should not be implemented until the plan rules are reviewed.

When billing is added:

- Family/internal accounts should not be charged.
- Other users should require payment for paid plans.
- Failed payment should downgrade or restrict paid entitlements without deleting user data.
- Plan changes should be auditable.
- Users should be able to export core records.

## Open Questions

- What is the first life area to prototype?
- Should Free include one AI-generated roadmap draft?
- How should receipt image storage be priced?
- Should Family be a plan now or later?
- Should debt tracking be included early, given the sensitivity?
- What financial disclaimers are required?
- Which data should be local-first or exportable from day one?
- Which auth provider should be used first?
