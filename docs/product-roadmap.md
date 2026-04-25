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

A major domain the user wants to manage, such as ambitions, career, relationships, food, language learning, fitness, travel, entertainment, shopping, receipts, or finances.

Roadmap:

A six-horizon plan for a life area.

Roadmap item:

A task, decision, habit, milestone, question, record request, or automation candidate.

Record:

Evidence or history attached to a life area. Examples include receipts, job applications, watched videos, people notes, restaurant ratings, workouts, trips, debts, bills, coupon codes, language practice notes, project notes, and uploaded files.

Review:

A recurring check-in where the user and AI turn roadmap status and records into the next set of actions.

Assistant:

An AI helper that drafts roadmaps, summarizes records, identifies missing information, and suggests next actions with clear uncertainty.

Service:

An optional automation that performs an external action after explicit user confirmation.

## Life Areas

### Ambitions

Purpose: manage goals, projects, websites, products, portfolios, businesses, creative work, and long-term plans.

Example uses:

- Build intrepion.com.
- Launch oliverforral.com as a software engineer portfolio.
- Launch karinnaaf.art as an artist portfolio.
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

### Entertainment

Purpose: remember what the user watched or listened to, when it happened, how they ranked it, and what they thought at the time.

Example uses:

- Track TV shows, movies, YouTube videos, podcasts, games, courses, talks, and playlists.
- Record last watched or listened date, progress, rating, notes, and context.
- Surface unfinished entertainment and changed opinions over time.
- Turn entertainment history into recommendations or reflection prompts.

### People And Relationships

Purpose: help the user remember people with more care and less stress.

Example uses:

- Track people, last-seen dates, where the user last saw them, and planned next hangouts.
- Keep notes about important life events, preferences, interests, and topics to ask about.
- Create reminders for thoughtful follow-ups, birthdays, milestones, or overdue reconnection.
- Review who the user has not seen recently and what would be meaningful to remember.

Boundary: this should feel like memory support for being more attentive, not a tool for manipulating people. Private notes about other people are sensitive and should be treated carefully.

### Food And Places

Purpose: remember where the user ate, cooked, shopped, and what was worth repeating.

Example uses:

- Track restaurants, bars, recipes, grocery stores, menu items, ratings, prices, and notes.
- Remember wait times, parking situations, atmosphere, service pace, and how busy the place felt.
- Track dishes, substitutions, ingredients, grocery store availability, and what the user would order or cook again.
- Connect food records to travel, shopping, receipts, budgets, and household planning.

Boundary: food preferences, allergies, dietary restrictions, spending, and location history can be sensitive. The product should avoid medical or nutrition claims unless explicitly reviewed.

### Career And Jobs

Purpose: help Oliver apply to jobs with less chaos and more follow-through.

Example uses:

- Track job postings, application status, contacts, deadlines, salary ranges, and follow-ups.
- Draft tailored resumes and cover letters from reviewed professional material.
- Prepare for interviews.
- Keep a roadmap for improving portfolio, skills, references, and outreach.
- Eventually connect to oliverforral.com as the public professional presence.

Boundary: AI must not invent experience, credentials, employment history, or commitments.

### Language Learning

Purpose: turn human language learning into a repeatable roadmap instead of scattered practice.

Example uses:

- Track target languages, vocabulary, phrases, grammar, listening, speaking, reading, and writing practice.
- Keep a review loop for weak areas.
- Use AI to generate practice from recent mistakes and goals.
- Track media practice, conversations, exercises, and review history.
- Connect entertainment records to language learning when the watched or listened content is in a target language.

### Fitness And Routines

Purpose: turn movement, workouts, recovery, and long-term capability into a repeatable roadmap.

Example uses:

- Track workouts, movement goals, habit streaks, strength, cardio, mobility, and recovery notes.
- Review what routine is realistic for the user's available time and constraints.
- Use AI to suggest practice plans from user goals and recent history.
- Connect fitness routines to travel, work, and energy patterns when useful.

Boundary: Intrepion may support fitness routines and general habit planning, but it should not diagnose, treat injuries, or replace medical advice.

### Travel Planning

Purpose: organize trips before, during, and after travel.

Example uses:

- Track destinations, dates, budgets, bookings, confirmation numbers, travel documents, packing lists, and saved places.
- Review what is booked, missing, unclear, or time-sensitive.
- Use AI to summarize trip records, draft packing lists, and surface constraints.
- Preserve post-trip notes, places visited, costs, and memories.

Boundary: travel documents and location history are sensitive records and should be handled carefully.

### Shopping, Coupons, And Receipts

Purpose: help Oliver compare prices, remember discounts, manage coupons, and keep receipt records so physical receipts can be discarded with confidence.

Example uses:

- Track item prices across stores.
- Record discounts, coupons, expiration dates, and whether a coupon is one-time use.
- Mark used coupons.
- Upload or photograph receipts.
- Extract store, date, items, totals, and payment method from receipts.
- Connect receipts to budget, returns, warranties, and price comparisons.

Boundary: receipt extraction should preserve source images or source metadata until the user trusts the record.

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

- Ambitions.
- Job search.
- People and relationships.
- Food and places.
- Language learning.
- Fitness and routines.
- Travel planning.
- Receipt capture and shopping memory.
- Debt payoff and financial recovery.

Recommended first wedge:

Start privately with Ambitions, because Oliver and Karinna already have two concrete portfolio launches that need roadmaps: oliverforral.com and karinnaaf.art.

Keep the public homepage's Career specimen for now, because career and job search are more immediately legible as a marketing example. The internal prototype and the public specimen do not need to be the same life area yet.

Deliverables:

- Define the shared data model for life areas, roadmaps, records, and reviews.
- Choose Ambitions as the first private prototype area.
- Create first Ambitions records for oliverforral.com and karinnaaf.art.
- Create static examples for all initial life areas.
- Decide what AI is allowed to draft in the first prototype.

### 1 Week

Goal: build one private, manually editable life-area prototype.

Deliverables:

- Ambitions prototype for portfolio launch roadmaps.
- Separate ambition records for oliverforral.com and karinnaaf.art.
- Manual record entry.
- Six-horizon roadmap view.
- Review summary view.
- AI-assisted roadmap draft from user-provided context.
- Export or backup path.

Important constraint: manual entry should work before automation. The product should not depend on brittle imports too early.

### 1 Month

Goal: make one or two life areas useful enough for repeated personal use.

Deliverables:

- Portfolio launch review loop for Oliver and Karinna.
- Portfolio records for domains, hosting, published pages, project/art assets, copy drafts, contact options, and open decisions.
- Receipt/photo upload exploration.
- Job application tracker.
- People and relationships review loop.
- Food and places memory.
- Language practice review loop.
- Fitness routine review loop.
- Travel planning records.
- Debt tracker with cautious financial-language boundaries.
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

- Long-term memory across ambitions, career, relationships, food, finances, learning, fitness, travel, entertainment, purchases, jobs, and personal goals.
- AI that understands the user's real history because it is grounded in records.
- Safe automation for repeatable life admin.
- Personal agents that act only within explicit permissions.
- Family or household modes if they become useful.

Strategic risk: the product could become too broad. The durable center should remain roadmaps, records, reviews, and AI-assisted next actions, not a pile of disconnected trackers.

## Current Strategic Bet

The strongest initial wedge is:

Build Intrepion for Oliver and Karinna's real portfolio ambitions first, using one shared model that can later extend across life areas.

The homepage can still use Career as the clearest marketing specimen. The product prototype should start with Ambitions because it creates immediate personal value: getting oliverforral.com and karinnaaf.art online with explicit records, open decisions, and six-horizon plans.

If the same structure can help with ambitions, career, relationships, food, language learning, fitness, travel, receipts, entertainment, and finances, the product has a real center. If each area needs a completely different product, the vision is too broad.
