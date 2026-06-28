# WriteFlow MVP Progress

Last updated: June 27, 2026

## MVP Goal

Complete the first magic loop:

1. Add notes from a book chapter.
2. Distill those notes into living ideas.
3. Open one idea and understand its structure.
4. Run a simulator session to test understanding.
5. Update mastery state.
6. Use that idea to generate a strong piece of writing.

## MVP Feature List

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | Living Ideas backend | Complete | Adds structured living idea generation, persistence, schema, API, and tests. |
| 2 | Idea Detail View | Complete | Adds an inspector/edit modal for living idea claim, mechanism, evidence, boundaries, counterarguments, questions, compressed principle, and mastery. |
| 3 | Idea Simulator | Not started | Guided Socratic session for explanation, application, critique, transfer, and compression. |
| 4 | Mastery Engine v1 | Not started | Update mastery state from simulator/review outcomes and schedule next review. |
| 5 | Write From Idea | Not started | Turn a living idea into thesis, paragraph, or argument outline with source grounding. |

## Completed

### Feature 1: Living Ideas Backend

Implemented:

- `services/livingIdeaEngine.js`
  - Builds Living Idea extraction prompts.
  - Normalizes LLM JSON into stable living idea objects.
  - Maps living ideas into existing `ideas` rows and new `living_ideas` rows.

- `routes/livingIdeas.js`
  - `POST /api/living-ideas/distill`
  - `GET /api/living-ideas`
  - `GET /api/living-ideas/:id`
  - `PATCH /api/living-ideas/:id`
  - `DELETE /api/living-ideas/:id`

- `server.js`
  - Registers `/api/living-ideas`.

- `supabase_schema.sql`
  - Adds `living_ideas` table.
  - Adds indexes for `book_id` and `idea_id`.
  - Adds `updated_at` trigger.
  - Enables RLS to match the current service-role backend security pattern.

- `tests/livingIdeaEngine.test.js`
  - Unit coverage for normalization, prompt-based generation with injected model, and row mapping.

- `tests/livingIdeasRoute.test.js`
  - Integration-style Express route coverage with fake Supabase and fake engine.

### Feature 2: Idea Detail View

Implemented:

- `index.html`
  - Adds an Inspect button to every idea card.
  - Adds a Living Idea modal for structured inspection.
  - Fetches living idea detail with `GET /api/living-ideas?idea_id=...`.
  - Saves structured edits with `PATCH /api/living-ideas/:id`.
  - Shows a legacy fallback state when older cards do not have living idea records.
  - Routes chapter distillation through `POST /api/living-ideas/distill` so new chapter cards have living idea records.

- `livingIdeaViewModel.js`
  - Shared browser/Node renderer and parser for read/edit living idea detail states.
  - Escapes rendered content and normalizes list fields from textarea input.

- `tests/livingIdeaViewModel.test.js`
  - Unit coverage for fallback records, HTML escaping, read rendering, edit rendering, form parsing, and mastery labels.

- `tests/livingIdeasRoute.test.js`
  - Integration coverage for loading detail by `idea_id` and patching supported structural fields only.

## Test Status

Latest local verification for this pass:

- Passed: `npm test`
- Passed: `node --check` across touched runtime and test files

## Remaining MVP Work

### Next Feature: Idea Simulator

Purpose:

Make every living idea testable through a short Socratic session that asks the user to explain, apply, critique, transfer, and compress the idea.

Needs:

- Start simulator from the Idea Detail View
- Prompts for explanation, example/application, boundary condition, counterargument, and compressed principle
- Store simulator session transcript or structured answers
- Score the session into a preliminary mastery signal
- Feed Mastery Engine v1 in the next feature

### Later Features

- Mastery Engine v1
- Write From Idea

## Risks / Notes

- Older broad/manual cards can be inspected through a read-only fallback, but only newly distilled chapter ideas have full living idea structures.
- The detail view intentionally preserves the existing card title/body editing flow; structural edits are saved separately on `living_ideas`.
- The next feature should add the simulator entry point to the detail modal rather than creating another disconnected surface.

