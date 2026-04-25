# Intrepion Product Roadmap

Intrepion is an AI-assisted life roadmap system for people who have too many open loops.

The product helps a person turn major life areas into roadmaps, records, reviews, and next actions. It should be useful for Oliver's real life first, then become general only where the pattern proves durable.

## Product Promise

Intrepion helps users answer:

- What am I trying to manage?
- What facts, records, or history do I already have?
- What matters in the next hour?
- What should be coherent by tomorrow?
- What should become repeatable this week?
- What should be meaningfully useful this month?
- What should become durable this year?
- What could compound for a decade?

AI should help draft, summarize, compare, and ask clarifying questions. The product center is not chat. The product center is the structured life roadmap.

## Core Model

Life area:

A major domain the user wants to manage, such as finances, job search, language learning, media memory, shopping, receipts, or personal projects.

Roadmap:

A six-horizon plan for a life area.

Roadmap item:

A task, decision, habit, milestone, question, record request, or automation candidate.

Record:

Evidence or history attached to a life area. Examples include receipts, job applications, watched videos, ratings, debts, bills, coupon codes, language practice notes, project notes, and uploaded files.

Review:

A recurring check-in where the user and AI turn roadmap status and records into the next set of actions.

Assistant:

An AI helper that drafts roadmaps, summarizes records, identifies missing information, and suggests next actions with clear uncertainty.

Service:

An optional automation that performs an external action after explicit user confirmation.

## Life Areas

### Roadmaps

Purpose: manage goals, projects, websites, products, portfolios, and long-term plans.

Example uses:

- Build intrepion.com.
- Build oliverforral.com.
- Build karinnaaf.art.
- Plan a product launch.
- Keep one-hour action and decade-scale ambition visible together.

### Finances And Debt

Purpose: help Oliver understand and reduce credit card debt without pretending the product is a financial advisor.

Example uses:

- Track debts, balances, interest rates, minimum payments, and due dates.
- Create a debt payoff roadmap.
- Record bills and recurring expenses.
- Identify unclear financial facts.
- Produce review summaries that help decide the next payment or spending constraint.

Boundary: Intrepion may organize and explain user-provided financial information, but it should not present itself as professional financial advice.

### Media Memory

Purpose: remember what Oliver watched, when he watched it, how he ranked it, and what he thought at the time.

Example uses:

- Track TV shows, movies, YouTube videos, courses, talks, and playlists.
- Record last watched date, progress, rating, notes, and context.
- Surface unfinished media and changed opinions over time.
- Turn media history into recommendations or reflection prompts.

### Language Learning

Purpose: turn human language learning into a repeatable roadmap instead of scattered practice. English and Spanish may be the first supported languages, but the model should not be limited to them.

Example uses:

- Track target languages, vocabulary, phrases, grammar, listening, speaking, reading, and writing practice.
- Keep a review loop for weak areas.
- Use AI to generate practice from recent mistakes and goals.
- Connect media records to language learning when the watched content is in a target language.

### Shopping, Prices, Coupons, And Receipts

Purpose: help Oliver compare prices, remember discounts, manage coupons, and keep receipt records so physical receipts can be discarded with confidence.

Example uses:

- Track item prices across stores.
- Record discounts, coupons, expiration dates, and whether a coupon is one-time use.
- Mark used coupons.
- Upload or photograph receipts.
- Extract store, date, items, totals, and payment method from receipts.
- Connect receipts to budget, returns, warranties, and price comparisons.

Boundary: receipt extraction should preserve source images or source metadata until the user trusts the record.

### Career And Jobs

Purpose: help Oliver apply to jobs with less chaos and more follow-through.

Example uses:

- Track job postings, application status, contacts, deadlines, salary ranges, and follow-ups.
- Draft tailored resumes and cover letters from reviewed professional material.
- Prepare for interviews.
- Keep a roadmap for improving portfolio, skills, references, and outreach.
- Eventually connect to oliverforral.com as the public professional presence.

Boundary: AI must not invent experience, credentials, employment history, or commitments.

## Six-Horizon Roadmap

### 1 Hour

Goal: make the new vision legible without pretending the whole life system exists.

Deliverables:

- Rewrite the homepage around AI-assisted life roadmaps.
- Show initial life areas.
- Show a public specimen of how one life area can be organized.
- Rewrite product documentation for the new model.

Explicit non-goals:

- Auth.
- Billing.
- Bank imports.
- Receipt scanning.
- Job application automation.
- Browser tracking.
- External service automation.

### 1 Day

Goal: choose the first private prototype area and define its data shape.

Candidate first areas:

- Debt payoff and financial recovery.
- Job search.
- Receipt capture and shopping memory.
- Language learning, starting with English and Spanish.

Recommended first wedge:

Start with job search plus debt payoff, because they are urgent, measurable, and emotionally important.

Deliverables:

- Define the shared data model for life areas, roadmaps, records, and reviews.
- Choose one first life area for a private prototype.
- Create static examples for all initial life areas.
- Decide what AI is allowed to draft in the first prototype.

### 1 Week

Goal: build one private, manually editable life-area prototype.

Deliverables:

- Manual record entry.
- Six-horizon roadmap view.
- Review summary view.
- AI-assisted roadmap draft from user-provided context.
- Export or backup path.

Important constraint: manual entry should work before automation. The product should not depend on brittle imports too early.

### 1 Month

Goal: make one or two life areas useful enough for repeated personal use.

Deliverables:

- Receipt/photo upload exploration.
- Job application tracker.
- Debt tracker with cautious financial-language boundaries.
- Language practice review loop.
- AI summaries that cite the records they used.
- Clear privacy and deletion rules.

Important constraint: AI should make uncertainty visible. It should ask for missing facts instead of inventing them.

### 1 Year

Goal: make Intrepion a reliable personal operating system.

Possible capabilities:

- Multiple life areas working from the same roadmap and record model.
- Search across records.
- Recurring reviews.
- Alerts and reminders.
- File and receipt storage.
- Integrations for selected services.
- Local-first or strong export options.
- Personal analytics that help the user decide what to do next.

### 1 Decade

Goal: make Intrepion a compounding life memory and planning system.

Possible capabilities:

- Long-term memory across projects, finances, learning, media, purchases, jobs, and personal goals.
- AI that understands the user's real history because it is grounded in records.
- Safe automation for repeatable life admin.
- Personal agents that act only within explicit permissions.
- Family or household modes if they become useful.

Strategic risk: the product could become too broad. The durable center should remain roadmaps, records, reviews, and AI-assisted next actions, not a pile of disconnected trackers.

## Current Strategic Bet

The strongest initial wedge is:

Build Intrepion for Oliver's real open loops, using one shared model across life areas.

If the same structure can help with debt, job search, language learning, receipts, media memory, and projects, the product has a real center. If each area needs a completely different product, the vision is too broad.
