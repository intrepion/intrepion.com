# Ambitions Prototype

Ambitions is the first private Intrepion prototype area.

The goal is to prove that Intrepion can help Oliver and Karinna move real portfolio launches forward before building a broad life-management app.

## Prototype Question

Can Intrepion turn two real portfolio goals into records, open decisions, six-horizon roadmaps, and review prompts that make the next action obvious?

If this does not help oliverforral.com and karinnaaf.art move forward, adding more life areas will probably create clutter instead of clarity.

## Data Model

Ambition:

A real goal or initiative the user wants to move forward. Examples include a portfolio site, product, art launch, business, creative project, or long-term personal goal.

Roadmap:

The six-horizon plan for an ambition:

- 1 hour
- 1 day
- 1 week
- 1 month
- 1 year
- 1 decade

Roadmap item:

A task, milestone, question, decision, record request, or review prompt attached to one horizon.

Record:

Evidence or context the roadmap can use. For portfolio ambitions, records may include domains, design references, project notes, artwork images, biography drafts, resume details, case study notes, hosting choices, analytics, and contact details.

Review:

A recurring check-in that turns the current roadmap and records into the next set of actions.

Open decision:

A choice that blocks progress until it is made or clarified. Examples include whether to start with a static page, which projects to feature, what tone the site should use, and what contact method should be public.

AI suggestion:

A draft, summary, comparison, or question generated from user-provided records. AI suggestions should be visibly reviewable and should not publish, send, or claim anything on the user's behalf.

## First Screen Shape

The first app-shaped screen should show:

- A list of ambitions.
- The current 1-hour action for each ambition.
- Missing records that would make the roadmap more useful.
- Open decisions blocking progress.
- The next review prompt.
- A clearly labeled AI suggestion area.

It does not need auth, billing, database persistence, uploads, or real AI yet.

## Ambition Example: oliverforral.com

Goal:

Launch a software engineer portfolio that helps potential employers and clients understand Oliver's work, judgment, projects, and direction.

Current state:

- Domain is owned.
- The portfolio concept is known.
- The exact first version is not yet defined.
- The future AI avatar idea is ambitious, but should not block the first public site.

Records needed:

- Domain registrar and DNS state.
- Current resume or professional summary.
- 3-5 projects worth featuring.
- Project descriptions, screenshots, links, and technical notes.
- Preferred contact method.
- A short statement about what kind of work Oliver wants next.

Open decisions:

- Should version one be a simple static portfolio or a fuller app-like experience?
- Which projects best prove Oliver's engineering judgment?
- What should the site say about the future AI avatar without overpromising it?
- What stack should be used only if it helps the first version ship?

Six-horizon roadmap:

| Horizon | Roadmap Item | Records | Review Prompt |
| --- | --- | --- | --- |
| 1 hour | Choose the first portfolio promise. | Resume, current project list, desired role/client type. | What should a visitor understand after 30 seconds? |
| 1 day | Draft the first site outline. | Bio draft, project names, contact method. | What can be published without waiting for perfect polish? |
| 1 week | Publish a simple portfolio. | DNS state, hosting choice, project copy, screenshots. | What is blocking a public link? |
| 1 month | Add stronger proof of work. | Case studies, metrics, testimonials, code links. | Which project deserves a deeper write-up? |
| 1 year | Turn the site into a durable professional presence. | New projects, job/client outcomes, writing, talks. | What changed about Oliver's professional direction? |
| 1 decade | Preserve a body of work and judgment. | Career milestones, major projects, decisions, public artifacts. | What should the long-term professional memory never misrepresent? |

Next review prompt:

What is the smallest honest version of oliverforral.com that can be published this week?

AI suggestion placeholder:

Draft a homepage outline from Oliver's resume, project notes, and desired audience. Mark missing facts instead of inventing experience.

## Ambition Example: karinnaaf.art

Goal:

Launch an artist portfolio that gives Karinna a public home for artwork, collections, biography, contact, and future updates.

Current state:

- Domain is owned.
- The portfolio concept is known.
- Artwork selection, site structure, and public contact flow need to be clarified.

Records needed:

- Domain registrar and DNS state.
- Artwork images.
- Titles, dates, media, dimensions, prices or availability if relevant.
- Artist statement or biography draft.
- Collection/grouping ideas.
- Preferred contact method.

Open decisions:

- Should the first version be a gallery, a portfolio, a shop-like catalog, or a simple artist homepage?
- Which works should be public first?
- Should pricing or availability appear now, later, or not at all?
- What tone should the artist statement use?

Six-horizon roadmap:

| Horizon | Roadmap Item | Records | Review Prompt |
| --- | --- | --- | --- |
| 1 hour | Pick the first public collection. | Artwork photos, titles, notes, favorites. | Which pieces should represent the first version? |
| 1 day | Draft the first artist-site structure. | Bio notes, collection names, contact method. | What page structure feels natural for the artwork? |
| 1 week | Publish a simple gallery or portfolio. | Optimized images, DNS state, hosting choice, captions. | What is blocking a public link? |
| 1 month | Add richer artwork context. | Process notes, series descriptions, availability rules. | What would make the site feel more like Karinna's work? |
| 1 year | Build an evolving art archive. | New collections, exhibitions, sales, commissions, updates. | What patterns are emerging across the work? |
| 1 decade | Preserve an artist record. | Major bodies of work, milestones, statements, press, decisions. | What should the long-term artist memory protect and clarify? |

Next review prompt:

What is the smallest beautiful version of karinnaaf.art that can be published this week?

AI suggestion placeholder:

Draft a first gallery structure from artwork records and artist notes. Ask for missing title, media, date, and availability details instead of inventing them.

## First Build Boundary

Build only enough to test whether this structure helps:

- Manual ambition creation.
- Manual record notes.
- Six-horizon roadmap display.
- Open decisions.
- Next review prompt.
- AI suggestion placeholder.

Do not build uploads, auth, billing, real AI, automations, or multi-user sharing yet.
