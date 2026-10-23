# Local design prototypes

The current **MVP 3 Household foundation prototype** is [a self-contained HTML file](public/households/index.html). Open it directly, or run `npm --prefix prototype run dev` and visit <http://127.0.0.1:4321/households/index.html>. No Rust server, credentials or real Google login are needed. See [the guided walkthroughs and review boundaries](../design/mvp-3/PROTOTYPE.md). MVP 3 wireframes and mockups are approved; the interactive prototype is approved; production implementation proceeds separately.

## Earlier prototypes

The **MVP 2 Everyday lists prototype** is at <http://127.0.0.1:4321/everyday/>. See [its walkthrough and review boundaries](../design/mvp-2/PROTOTYPE.md). Start it with `npm --prefix prototype run dev` after the one-time dependency installation below. No Rust server is required. MVP 2's wireframes, mockups, and standalone prototype are approved; production implementation is in progress.

The original MVP 1 task prototype remains at <http://127.0.0.1:4321/>. Its approved review record follows.

## MVP 1 task prototype

Review question: do the approved task workflows, pending states, and recovery interactions feel right before production implementation?

This is a separate, throwaway Astro/TypeScript website based on the wireframes approved in Q35 and mockups approved in Q36. Its application code must not be promoted into `/web`. Themes remain an idea for a later MVP.

## Run

From the repository root, install the locked dependencies once:

```sh
npm --prefix prototype ci
```

Then start the prototype with one command:

```sh
npm --prefix prototype run dev
```

Open <http://127.0.0.1:4321>. No Rust server, cloud accounts, or credentials are required. Use a current Node.js version supported by the locked Astro release; this prototype was verified with Node 26.12.0.

Ordinary foreground development stops with Ctrl+C. If Astro starts a background process in an agent terminal, stop it with `npm --prefix prototype run dev -- stop`. A static build can also be served using `npm --prefix prototype run build` followed by `npm --prefix prototype run preview`; stop a background preview with `npm --prefix prototype run preview -- stop`.

## Walkthrough

1. Select **Continue with Google** to simulate owner sign-in. Create a task, edit its title and notes, complete it, and reopen it. Completed tasks stay visible below incomplete tasks.
2. Change a draft and select Cancel or Back. Check the discard confirmation and keyboard focus. Delete a task, first canceling the confirmation, then confirming permanent removal.
3. Expand **Review scenarios**. Choose **Fails before saving** for the next task action, then save or complete a task. The displayed state remains unchanged until a successful retry.
4. Choose **Saves, but response is lost**. The simulated backend accepts the action while the displayed state stays at the last confirmed version. Retry and inspect the result: a created task appears once, and completion is not toggled twice.
5. Try a slow response, an empty list, access denial, a canceled sign-in, unavailable loading, and an expired session while editing. **Finish loading** ends the deliberate cold-start scenario. A simulated sign-in after expiry resumes the draft.
6. Try keyboard navigation and a narrow/mobile window. The nested state inspector explains the simulated state during review.

All tasks live only in memory. Signing out hides them; signing in again in the same tab keeps them. Reloading or **Reset demo** restores the synthetic sample. Reset and scenario changes protect unsaved drafts. This temporary behavior does not change the production requirement for durable task storage.

Google sign-in, authorization, delays, failures, and persistence acknowledgments are simulations. The page makes no backend or third-party requests. The Google mark is the approved local design asset; production must implement real Google authentication and the appropriate official sign-in control.

## Local verification

```sh
npm --prefix prototype run check
npm --prefix prototype run test:unit
npm --prefix prototype run test:e2e
```

The browser suite builds the static site and starts its own preview server on port 4321. Stop any existing development/preview server on that port first. E2E tests are local only and deliberately refuse to run when `CI` is set. The browser executable defaults to `/usr/local/bin/chromium`; set `CHROMIUM_PATH` to your installed Chromium executable if needed.

Verified: Astro check has no errors, warnings, or hints; three model tests and eight browser workflows pass. Browser coverage includes task CRUD, validation, retries after lost responses, focus restoration, draft recovery, simulated session changes, mobile overflow, and literal rendering of untrusted task text. These checks do not establish production authentication, accessibility conformance, hosted service behavior, or real persistence.

Desktop and mobile screenshots are in [the design review folder](../design/mvp-1/README.md). Prototype interactions were approved in Q37. Production application code is implemented independently in `/server` and `/web`.
