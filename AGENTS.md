# Intrepion Agent Instructions

## Product Thesis

Intrepion is an AI-assisted life roadmap system for people who have too many open loops.

The product helps a person organize important areas of life into clear roadmaps, supporting records, reviews, and next actions. The core primitive is not a generic task list. It is:

- Life area: a major domain the user wants to manage.
- Roadmap: a six-horizon plan for that life area.
- Record: evidence, context, history, receipts, ratings, applications, notes, or progress data attached to the roadmap.
- Review: a recurring moment where AI and the user turn the records into next actions.

The first user is Oliver. Intrepion should be useful for his actual life before it tries to become a broad consumer platform.

## Life Areas

Initial life areas:

- Ambitions: goals, projects, sites, products, portfolios, businesses, creative work, and long-term plans.
- Finances: debt payoff, bills, spending decisions, and financial recovery.
- Entertainment: TV shows, movies, YouTube videos, watch history, progress, ratings, and why something mattered at the time.
- People and relationships: people, last-seen dates, life notes, preferences, follow-ups, and plans to reconnect.
- Food and places: restaurants, bars, recipes, grocery stores, menu items, wait times, parking, ratings, and what was worth repeating.
- Language learning: target languages, practice history, vocabulary, mistakes, listening, speaking, reading, media practice, and review loops.
- Shopping and receipts: price tracking across stores, discounts, coupons, one-time-use offers, receipt capture, and purchase history.
- Career and jobs: job search roadmaps, applications, tailored resumes, interview preparation, and follow-up tracking.
- Fitness and routines: workouts, movement goals, habit streaks, recovery notes, strength, cardio, and mobility roadmaps.
- Travel: trips, bookings, budgets, packing lists, travel documents, saved places, and post-trip notes.

These should not become six unrelated apps. Each area should reuse the same product grammar: roadmap, records, status, review, next action, and AI assistance.

## Time Horizons

The six time horizons are fixed product language and should not be casually renamed:

- 1 hour: what can create useful progress immediately
- 1 day: what can make the area coherent and usable
- 1 week: what can make the workflow repeatable
- 1 month: what can make the system meaningfully useful
- 1 year: what can make the area durable
- 1 decade: what can make the work compound

## AI Direction

AI should be central, but bounded. The product should not become a generic chatbot.

AI should help:

- Turn messy goals and records into structured roadmaps.
- Summarize receipts, financial facts, applications, entertainment history, and learning progress.
- Identify missing information and unclear assumptions.
- Suggest next actions for each life area.
- Draft plans, job materials, language practice, shopping comparisons, and review summaries.

AI should not:

- Pretend uncertain information is true.
- Give professional financial, legal, medical, or employment guarantees.
- Make purchases, payments, applications, or external commitments without explicit user confirmation.
- Delete user records without explicit confirmation.
- Hide the source of a recommendation when evidence is available.

For high-stakes areas such as debt, finances, employment, and credentials, the product should clearly distinguish organization and planning from professional advice.

## Target User

Start with one honest target user:

- Oliver Forral: a software engineer trying to manage projects, job search, relationships, food, language learning, fitness, travel, entertainment, shopping decisions, receipts, debt, and long-term personal goals.

Secondary early user:

- Karinna Forral: a regular user whose needs may include art portfolio planning, household records, shopping, receipts, and personal goals.

Do not prematurely design for enterprise teams. If team or business features return later, they should grow from repeated real use.

## Core Product Model

Use these concepts consistently:

- User: a person who owns life areas, roadmaps, records, reviews, credentials, and preferences.
- Life area: a domain of life the user wants to manage.
- Roadmap: a structured plan for a life area across the six fixed time horizons.
- Roadmap item: a task, decision, habit, record request, review, milestone, or automation candidate.
- Record: a stored fact or artifact, such as a receipt, bill, job application, watched video, rating, vocabulary note, or project note.
- Source: where a record came from, such as manual entry, upload, photo, email import, browser capture, API, or AI extraction.
- Review: a periodic check-in that turns records and roadmap status into next actions.
- Assistant: an AI helper that drafts, summarizes, compares, and asks clarifying questions.
- Service: an optional automation that performs an external action after explicit confirmation.
- Plan: an entitlement bundle controlling limits, AI usage, storage, imports, automation, and support.

## Product Priorities

Build in this order unless there is a clear reason to change:

1. Public positioning and SEO page for the new life-roadmap vision.
2. Static examples showing the initial life areas and their six-horizon roadmaps.
3. Product documentation for the life-area model, AI boundaries, records, reviews, and plans.
4. A tiny private Ambitions prototype for launching oliverforral.com and karinnaaf.art.
5. Manual record entry for ambitions, including domains, portfolio assets, copy drafts, hosting choices, open decisions, and launch tasks.
6. AI-assisted roadmap drafting from user-provided context.
7. Receipt/photo upload exploration.
8. Career/job search tracker and AI-assisted application workflow.
9. Language learning roadmap and review workflow.
10. Fitness and routines tracker.
11. Travel planning tracker.
12. Finance/debt roadmap tracker with cautious, non-advisory language.
13. People and relationships tracker.
14. Food and places tracker.
15. Entertainment tracker.
16. Shopping, coupon, and price tracking.
17. External imports, credentials, and automation only after the core model is proven.

## MVP Exclusions

Do not implement these before the public page, documentation, and core model are coherent:

- Real payment collection.
- Production social login.
- Bank account aggregation.
- Automatic bill payment.
- Automatic job applications.
- Automatic purchases.
- Broad browser tracking.
- Fully automated receipt ingestion.
- Large-organization controls.
- A broad plugin or integration marketplace.

These features may matter later, but implementing them too early will distract from proving whether life areas plus AI-assisted roadmaps are useful.

## Plan Names

Use these exact public plan names unless the product direction changes:

- Free
- Plus
- Life
- Household
- Family

The old Pro, Business, and Enterprise framing is no longer the center. If business plans return later, document why.

Privacy should not be a paywall. Free users should be able to create private roadmaps, but with shallow limits such as one active roadmap per life area, limited records, and limited AI usage.

Oliver and Karinna should be able to use paid-plan capabilities without actual payment. Other users should eventually require payment for paid entitlements.

## Sensitive Areas

Treat the following as sensitive:

- Financial records, debt, bills, credit cards, bank imports, and payment data.
- Job applications, resumes, salary targets, employment history, and employer contacts.
- Fitness routines, body goals, recovery notes, and injury-related context.
- Travel documents, itineraries, location history, and identity documents.
- Private notes about other people, relationship history, and contact details.
- Food preferences, allergies, dietary restrictions, location history, and spending patterns.
- Receipts, purchase history, store accounts, coupons, and discount codes.
- Credentials, API keys, OAuth tokens, and uploaded documents.
- Personal language-learning notes and entertainment history if the user marks them private.

Sensitive areas require explicit review before implementation.

## Technical Direction

This repository is starting as a static marketing and product-spec surface. Do not introduce a full application framework until the product direction is reviewed.

Prefer simple, reviewable artifacts first:

- Static HTML for the public page.
- Markdown docs for product rules.
- Clear file names over premature abstraction.

When application work begins, choose the stack based on the first real implementation task, not a hypothetical decade-scale architecture.

## Writing Style

Use direct, practical language. Avoid vague phrases like "unlock productivity" unless paired with concrete product behavior.

Public copy should make the product feel like a practical life system, not a generic AI assistant. It should show how roadmaps, records, reviews, and AI work together.

## Implementation Standards

- Keep changes small and easy to review.
- Prefer explicit product rules over hidden assumptions.
- Do not fake working features in the UI.
- If a button is not wired up, label it as early access, preview, or planned.
- Do not imply banking, payment, job application, purchase, import, or automation features are live before those systems exist.
- Keep internal/family exemptions documented separately from public pricing.
- Treat credentials, finances, employment, fitness, travel documents, billing, and external automation as sensitive areas that need explicit review before implementation.
