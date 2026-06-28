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
| 2 | Idea Detail View | Not started | Frontend surface to inspect/edit claim, mechanism, evidence, boundaries, counterarguments, and mastery. |
| 3 | Idea Simulator | Not started | Guided Socratic session for explanation, application, critique, transfer, and compression. |
| 4 | Mastery Engine v1 | Not started | Update mastery state from simulator/review outcomes and schedule next review. |
| 5 | Write From Idea | Not started | Turn a living idea into thesis, paragraph, or argument outline with source grounding. |

## Completed This Pass

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

- `package.json`
  - Adds `npm test` for the Living Ideas unit and integration tests.

- `tests/livingIdeaEngine.test.js`
  - Unit coverage for normalization, prompt-based generation with injected model, and row mapping.

- `tests/livingIdeasRoute.test.js`
  - Integration-style Express route coverage with fake Supabase and fake engine.

## Test Status

Pending final run in this pass:

- `npm test`
- `node --check` across server, route, service, middleware, and tests

## Remaining MVP Work

### Next Feature: Idea Detail View

Purpose:

Give the user a serious inspection/editing surface for one living idea.

Needs:

- API usage from `GET /api/living-ideas?idea_id=...`
- Modal or side panel from idea cards
- Sections for claim, definition, mechanism, evidence, examples, boundaries, counterarguments, open questions, compressed principle, and mastery
- Patch support using `PATCH /api/living-ideas/:id`
- Empty states for older idea cards without living idea records

### Later Features

- Idea Simulator
- Mastery Engine v1
- Write From Idea

## Risks / Notes

- The current frontend still uses legacy idea cards. Living Ideas are now available through API, but the detail UI is still needed for users to experience the richer structure.
- New LLM generation uses `services/llmClient.js`, so it can route through Ollama/OpenAI/Anthropic like the Essay Agent.
- The new route is authenticated through existing `/api` middleware in `server.js`.

