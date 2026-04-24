# Intrepion Agent Instructions

## Product Thesis

Intrepion helps people turn ambitious goals into dynamic roadmaps across six time horizons:

- 1 hour
- 1 day
- 1 week
- 1 month
- 1 year
- 1 decade

The product should make planning feel concrete, revisable, and connected to execution. The first public example is Intrepion's own roadmap for becoming a useful roadmap business.

## Target Users

Start with solo creators, technical founders, and small teams who are trying to launch websites, portfolios, products, or businesses without losing track of what matters now versus later.

Initial internal users:

- Oliver Forral: admin and regular user
- Karinna Forral: regular user

Initial owned-project examples:

- intrepion.com: the roadmap-management business
- oliverforral.com: Oliver's portfolio site
- karinnaaf.art: Karinna's portfolio site

## Core Product Model

Use these concepts consistently:

- User: a person who can own roadmaps, projects, credentials, and support requests.
- Admin: a user with permission to manage users, tutorials, services, plans, and published content.
- Project: a real-world goal, site, app, business, portfolio, or initiative.
- Roadmap: a structured plan for a project across the six fixed time horizons.
- Roadmap item: a task, decision, tutorial, service, or milestone within a roadmap.
- Tutorial: human-readable guidance tied to roadmap choices.
- Service: automation that can perform part of a tutorial through an external API.
- Plan: an entitlement bundle controlling roadmap limits, support level, tutorial requests, automation, seats, and API access.

## Time Horizons

The six time horizons are fixed product language and should not be casually renamed:

- 1 hour: what can create useful progress immediately
- 1 day: what can make the project coherent and usable
- 1 week: what can make the workflow repeatable
- 1 month: what can make the product valuable enough to charge for
- 1 year: what can make the business durable
- 1 decade: what can make the work compound

## Product Priorities

Build in this order unless there is a clear reason to change:

1. Public positioning and SEO page.
2. Static example roadmap for Intrepion itself.
3. Product documentation for pricing, roles, and roadmap behavior.
4. Authentication and basic user profile.
5. Projects and roadmaps.
6. Admin user management.
7. Billing and plan enforcement.
8. Tutorial management.
9. Tutorial request workflow.
10. External service integrations.
11. Credential management.
12. Human support workflow.
13. AI support and AI-generated tutorials, with admin review before publishing.

## MVP Exclusions

Do not implement these before the public page, documentation, and core roadmap model are coherent:

- Real payment collection.
- Production social login.
- Live admin chat.
- External API automation.
- AI-generated tutorials.
- Multi-tenant enterprise controls.
- A broad plugin or integration marketplace.

These features are planned, but implementing them too early will distract from validating whether people understand and want dynamic roadmaps.

## Plan Names

Use these exact public plan names:

- Free
- Plus
- Pro
- Business
- Enterprise

Oliver and Karinna should be able to use paid-plan capabilities without actual payment. Other non-admin users should eventually require payment for paid entitlements.

## Support Model

Start with simple, honest support:

- Free, Plus, and Pro: automated help, documentation, and support request forms.
- Business and Enterprise: priority human support during published work hours.

Avoid promising live chat until there is a real operational process behind it.

## Tutorial And Automation Rules

Tutorials and services are separate concepts:

- Tutorials explain what to do.
- Services perform actions through APIs.

Examples of future services:

- Namecheap domain configuration.
- Neon database setup.
- Google Cloud project setup and deployment configuration.
- GitHub repository and GitHub Actions setup.

Any AI-generated tutorial or service must require admin review before publishing or execution.

## Technical Direction

This repository is starting as a static marketing surface. Do not introduce a full application framework until the product direction is reviewed.

Prefer simple, reviewable artifacts first:

- Static HTML for the first public page.
- Markdown docs for product and business rules.
- Clear file names over premature abstraction.

When application work begins, choose the stack based on the first real implementation task, not a hypothetical decade-scale architecture.

## Writing Style

Use direct, practical language. Avoid vague SaaS phrases like "unlock productivity" unless paired with concrete product behavior.

When writing public copy, make the first example Intrepion's own roadmap. The site should demonstrate the product instead of only describing it.

## Implementation Standards

- Keep changes small and easy to review.
- Prefer explicit product rules over hidden assumptions.
- Do not fake working features in the UI. If a button is not wired up, label it as early access, preview, or planned.
- Do not add payment, auth, or chat UI that implies production behavior before those systems exist.
- Keep family/admin exemptions documented separately from public pricing.
- Treat credentials, billing, and API automation as sensitive areas that need explicit review before implementation.
