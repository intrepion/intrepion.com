# Ambition Export Contract

This document defines how Intrepion should turn structured Ambition data into a human-readable Markdown export.

The source of truth is structured data. Markdown is a generated review, export, documentation, or backup format.

## Source File

Current seed example:

- `data/ambitions/oliverforral.json`

Current generated example:

- `docs/ambitions/oliverforral.md`

## Required Fields

An Ambition JSON record must include:

- `id`: stable machine-readable identifier.
- `name`: user-facing ambition name.
- `type`: machine-readable ambition type.
- `owner.name`: owner display name.
- `goal`: one clear sentence or paragraph describing the desired outcome.
- `currentState`: array of current facts.
- `acceptedDirection`: array of accepted direction statements.
- `records`: array of labeled records.
- `openDecisions`: array of unresolved decisions.
- `roadmap`: array containing all six fixed horizons.
- `nextCheckIn`: the next check-in question.
- `aiAssistanceRequest`: the current AI assistance request.
- `generatedSummary`: array of summary paragraphs.
- `firstUsefulNextAction.action`: immediate next action.

## Required Horizons

Every exported Ambition must include exactly these horizons, in this order:

1. `1 hour`
2. `1 day`
3. `1 week`
4. `1 month`
5. `1 year`
6. `1 decade`

Each roadmap item must include:

- `horizon`
- `item`
- `records`
- `checkInQuestion`

## Optional Fields

The structured source may later include:

- `status`
- `createdAt`
- `updatedAt`
- `visibility`
- `tags`
- `lifeArea`
- `reviewHistory`
- `aiSuggestionHistory`
- `attachments`
- `sourceLinks`

Optional fields should not appear in exports unless they are useful to the user reading the generated artifact.

## Markdown Render Order

Render Markdown exports in this order:

1. H1: `{name} Ambition`
2. `Summary`
3. `Current State`
4. `Accepted Direction`
5. `Records`
6. `Open Decisions`
7. `Six-Horizon Roadmap`
8. `Next Check-In`
9. `AI Assistance Request`
10. `Generated Summary`
11. `First Useful Next Action`

## Markdown Rendering Rules

### Heading

Use:

```md
# {name} Ambition
```

### Summary

Render `type`, `owner.name`, and `goal`.

The type may be converted from machine format to display format. For example:

- `portfolio_site` becomes `Portfolio site`.

### Arrays

Render arrays as bullet lists.

Example:

```md
- The domain `oliverforral.com` is owned.
- The first version will be a simple portfolio site.
```

### Records

Render each record as:

```md
- {label}: {value}.
```

Do not duplicate punctuation if `value` already ends in punctuation.

### Roadmap

Render `roadmap` as a Markdown table with these columns:

```md
| Horizon | Roadmap Item | Records | Check-In Question |
| --- | --- | --- | --- |
```

Render `records` inside the table as a comma-separated list.

### Generated Summary

Render each `generatedSummary` entry as its own paragraph.

### First Useful Next Action

Render `firstUsefulNextAction.action` as the action.

If `firstUsefulNextAction.draft` exists, render it under `Draft:`.

## Exclusions

Markdown exports must not include:

- Rejected AI suggestions.
- Unselected AI suggestions.
- Transient AI loading states.
- Rate-limit errors.
- Credential or payment gating messages.
- UI-only labels such as button text.
- Raw prompt history unless the user explicitly exports it.
- Internal debugging information.

The export should read like the current accepted plan, not a transcript of how the user and AI arrived there.

## AI Rules

AI may draft or revise exported text, but accepted user data remains the source of truth.

AI must not:

- Invent experience, credentials, project outcomes, employment history, or commitments.
- Present uncertain data as fact.
- Publish, send, or execute anything from the export without explicit user confirmation.

When data is missing, AI should either omit the claim or produce an open decision/check-in question.

## Validation Rules

Before generating an export:

- Validate that all six horizons are present.
- Validate that each horizon has an item and check-in question.
- Validate that required fields are present.
- Warn if records or open decisions are empty.
- Warn if generated text contains claims not supported by source records.

## Product Principle

Structured data is for editing.

Markdown is for reading, review, export, and backup.

The app should make it easy to move between both without letting the generated Markdown become the only source of truth.
