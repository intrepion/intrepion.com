# Intrepion Product Roadmap

Intrepion is a roadmap-management business built around dynamic planning across six horizons: 1 hour, 1 day, 1 week, 1 month, 1 year, and 1 decade.

The first roadmap Intrepion should manage is its own.

## Product Promise

Intrepion helps users turn a large goal into a living roadmap that separates immediate next steps from longer-term architecture, operations, automation, and strategy.

AI should help draft and revise roadmap guidance, but the core artifact is still the roadmap. Intrepion should not become a generic chatbot. AI output should be structured into horizons, roadmap items, tutorial needs, missing guidance, assumptions, and service opportunities.

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

## Owned Example Roadmaps

The first examples should be ambitious enough to show why AI-assisted roadmaps matter, while staying honest about what is reviewed, planned, or missing.

### intrepion.com

Product ambition: an AI-assisted roadmap business that turns user goals into six-horizon roadmap drafts, identifies missing tutorials, and eventually turns repeated tutorial work into reviewed services.

Horizon sketch:

- 1 hour: publish the differentiated homepage and public roadmap specimen.
- 1 day: model users, projects, roadmaps, plans, tutorials, and tutorial requests.
- 1 week: define safe service integration patterns for Namecheap, Neon, Google Cloud, and GitHub.
- 1 month: allow AI-generated tutorial and service drafts with admin review before publishing.
- 1 year: make roadmap operations repeatable through templates, reviews, collaboration, and public roadmap publishing.
- 1 decade: build a compounding planning and execution platform with verified guidance, organizational memory, and governed automation.

### oliverforral.com

Product ambition: an AI-assisted software engineer portfolio that starts with proof of work and grows into a reviewed professional avatar for employers, clients, and collaborators.

Horizon sketch:

- 1 hour: publish a simple software engineer portfolio with positioning, strongest projects, contact path, and current availability.
- 1 day: add case studies, work history, project screenshots, resume content, and a profile summary.
- 1 week: structure portfolio content so it is AI-readable: projects, skills, decisions, outcomes, constraints, and proof.
- 1 month: add an AI-assisted Q&A prototype that answers from reviewed portfolio content without inventing experience, claims, or commitments.
- 1 year: grow the site into a durable professional presence with writing, project updates, services, testimonials, and analytics on visitor questions.
- 1 decade: build a professional memory and avatar that can explain what Oliver has built, how he thinks, what roles fit, and what work he wants next.

Important boundary: the AI should represent reviewed professional material. It should not invent credentials, speak for Oliver beyond approved facts, or make commitments to employers or clients.

### karinnaaf.art

Product ambition: an AI-assisted artist portfolio that starts with selected work and grows into an artist-approved studio guide for collectors, collaborators, and visitors.

Horizon sketch:

- 1 hour: publish a simple artist portfolio with selected works, artist statement, contact path, and a clear first collection.
- 1 day: add artwork details such as titles, mediums, dimensions, availability, series notes, process notes, and high-quality images.
- 1 week: structure the studio archive so it is AI-readable: works, collections, themes, materials, influences, exhibitions, pricing status, and collector questions.
- 1 month: add an AI-assisted studio guide prototype that answers from artist-approved content without inventing meaning, prices, availability, or biography.
- 1 year: grow the site into a collector and collaborator hub with collection updates, commissions, newsletters, studio notes, inquiry workflows, and analytics on visitor questions.
- 1 decade: build a durable studio memory that preserves the evolution of the work, helps visitors explore themes across collections, and supports future exhibitions, licensing, and collector relationships.

Important boundary: the AI should be an artist-approved studio guide, not an automated substitute for the artist's authorship or interpretation.

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
