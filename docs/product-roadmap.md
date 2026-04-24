# Intrepion Product Roadmap

Intrepion is a roadmap-management business built around dynamic planning across six horizons: 1 hour, 1 day, 1 week, 1 month, 1 year, and 1 decade.

The first roadmap Intrepion should manage is its own.

## Product Promise

Intrepion helps users turn a large goal into a living roadmap that separates immediate next steps from longer-term architecture, operations, automation, and strategy.

The product should answer:

- What matters in the next hour?
- What should exist by tomorrow?
- What should become repeatable this week?
- What should be valuable enough to charge for this month?
- What should become durable this year?
- What could compound for a decade?

## One-Hour Target

Goal: create a credible public foundation without pretending the full SaaS already exists.

Deliverables:

- SEO-optimized static marketing page for intrepion.com.
- Public positioning around dynamic roadmaps.
- Example roadmap for building Intrepion itself.
- Product documentation for roadmap phases, pricing, and entitlement rules.
- AGENTS.md instructions for future coding sessions.

Explicit non-goals:

- Production Google login.
- Billing collection.
- Real-time support chat.
- Admin dashboard.
- Project CRUD.
- External API integrations.

Reasoning: auth, billing, support, admin tools, and CRUD are not "basic" if they need to be secure, trustworthy, and maintainable. The first hour should make the product direction legible.

## One-Day Target

Goal: make the roadmap concept usable enough for internal users.

Deliverables:

- Choose application stack.
- Scaffold app shell.
- Add authentication plan and provider configuration notes.
- Model users, projects, roadmaps, roadmap items, plans, and admin roles.
- Create seed data for:
  - intrepion.com
  - oliverforral.com
  - karinnaaf.art
- Add a simple admin-only tutorial-management concept, even if content starts in markdown.
- Add static tutorial placeholders for:
  - Registering a domain with Namecheap.
  - Creating a Neon account and database.
  - Creating a Google Cloud account and claiming available startup credits.
  - Creating a GitHub account and repository.
  - Deploying from GitHub Actions to Google Cloud.

User-facing behavior:

- Users can view roadmap examples.
- Users can see tutorial availability.
- Paid-plan users can request planned tutorials.

## One-Week Target

Goal: connect tutorials to real service integration planning.

Deliverables:

- Credential-management design for external services.
- Admin-managed service definitions.
- First integration spike for one external service.
- Tutorial page pattern with a "Help me through this" action for eligible plans.
- Audit log design for service actions.
- Clear permission boundary between reading credentials, using credentials, and deleting credentials.

Candidate services:

- Namecheap API.
- Neon API.
- Google Cloud APIs.
- GitHub API.

Important constraint: tutorial services should not run destructive or billable actions without explicit user confirmation.

## One-Month Target

Goal: introduce paid workflow depth, team management, and AI-assisted support without losing admin review.

Deliverables:

- AI credential management for users who want to bring their own provider keys.
- Pro, Business, and Enterprise AI support flow.
- Business and Enterprise team management.
- Seat management with bulk discount rules.
- API access plans with rate-limit tiers.
- AI-generated tutorial drafts.
- AI-generated service drafts.
- Admin review and publishing workflow.

Important constraint: AI can draft instructions and service code, but admins must review before publication or execution.

## One-Year Target

Goal: make Intrepion a reliable operating system for project roadmaps.

Possible capabilities:

- Roadmap templates by goal type.
- Integration marketplace.
- Versioned roadmaps.
- Collaboration and comments.
- Approval workflows.
- Scheduled reviews.
- Organization-level governance.
- Public roadmap publishing.
- Analytics on roadmap progress and bottlenecks.

Business target:

- Clear conversion path from Free to Plus or Pro.
- Business plan for teams that need collaboration, support, and automation.
- Enterprise plan for organizations with compliance, procurement, and custom integration needs.

## One-Decade Target

Goal: make Intrepion a compounding planning and execution platform.

Possible capabilities:

- Roadmaps that adapt to real outcomes.
- Service automation that can execute repeatable operational work.
- Verified tutorial and automation library.
- Organization memory for decisions, credentials, systems, and processes.
- Marketplace for expert-reviewed roadmap packs.
- Cross-project dependency mapping.
- Governance for AI-generated operational changes.

Strategic risk: the product could become too broad. The durable center should remain dynamic roadmaps, not generic project management, generic chat, generic tutorials, or generic automation.

## Current Strategic Bet

The strongest initial wedge is:

Build Intrepion in public using Intrepion's own dynamic roadmap.

This makes the marketing page, product demo, tutorial content, and internal planning artifact the same thing.
