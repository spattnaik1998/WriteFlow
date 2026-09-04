# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npm start            # run server (node server.js)
npm run dev          # run with auto-reload via nodemon
npm test             # run all test files sequentially
node tests/writingQuality.test.js    # run a single test file
```

Tests are plain `node:assert` scripts with no test framework — each file defines `testXxx()` functions and calls them at the bottom, throwing on failure. `npm test` chains them with `&&`, so a new test file does nothing until it's added to the `test` script in `package.json`. No linter is configured.

### Two checkouts: development and writing

The repo is checked out twice via `git worktree`, so the owner can keep writing notes while a branch is being edited:

| Path | Branch | Port | Purpose |
|---|---|---|---|
| `WriteFlow/` | `master` | 3100 | where changes are made |
| `WriteFlow-local/` | `stable` | 3000 | the app the owner actually writes in |

Ports are pinned in each checkout's own `.env` (untracked), so both run at once and the writing copy's URL never moves. **Port 3000 is the owner's live writing session — never kill a server on it, and start dev servers from `WriteFlow/`.** `stable` advances only by an explicit merge from `master`.

Both checkouts share one Supabase project, so notes, books and ideas are the *same data* in both. This is deliberate. It also means a change that writes to the database is not sandboxed by the branch — treat destructive DB work as production work regardless of which checkout it runs from.

## Architecture

WriteFlow is a single-user book-note distillation and essay-writing app. Users dump rough notes per chapter, LLMs distil them into idea cards, and an agentic essay harness turns the accumulated library into synthesis essays.

**Single-server, single-file frontend:**
- `server.js` — Express server; serves `index.html` statically and mounts ~24 routers under `/api/*`
- `index.html` — the *entire* frontend in one ~520KB file (vanilla JS, embedded CSS). No build step, no framework. Everything is global-scope functions and module-level `let` state.
- `routes/` — one file per domain; every router is mounted in `server.js` (a new route file does nothing until registered there)
- `services/` — LLM wrappers and integrations
- `middleware/auth.js` — the auth gate
- `tests/` — assert-based unit tests

### Auth model

`app.use('/api', requireAuth)` gates everything except two endpoints that must stay public: `/api/health` (the frontend's live-mode probe, called before login) and `/api/auth/config` (hands the browser the Supabase URL + anon key so it can run the OAuth flow itself).

`requireAuth` verifies a Supabase GitHub-OAuth bearer token, then checks the verified email against `ALLOWED_EMAIL`. **There is no per-user data model — every table is shared.** This is a single-user allow-list, not row-level access control; don't add `user_id` filtering assuming it exists.

The server's Supabase client uses `SUPABASE_SERVICE_ROLE_KEY` and therefore bypasses RLS by design; access control lives in the API layer instead. `services/supabase.js` throws at require-time if that key is missing.

### Prototype / live mode duality

The frontend boots in prototype mode with hardcoded sample data (`PROTOTYPE_*` constants). On load it calls `GET /api/health`; if that responds it sets `IS_LIVE_MODE = true` and starts the Supabase auth flow. Most user-facing functions branch on `IS_LIVE_MODE` and have both a sample-data path and a real-API path — preserve both branches when editing them.

Backend calls go through `api(method, path, body)` or `_authHeaders()`, which attach `Authorization: Bearer <token>` from `_authSession`. **`api()` swallows errors and returns `null`** so prototype mode keeps working — callers must distinguish `null` (request failed) from `[]` (empty but valid). Raw `fetch` calls elsewhere in `index.html` must set auth headers manually; forgetting this has caused real bugs (commits `26aed00`, `193d73f`).

### LLM layer — two distinct paths

**`services/openai.js`** is the legacy path: ~25 exported functions (`distillNotes`, `chatWithPartner`, `generateMacroNarrative`, `queryWiki`, `reconstructArgument`, …) calling `gpt-4o` directly. Most feature routes use this.

**`services/llmClient.js`** is the newer provider-agnostic path used by the essay agent. `generateText`/`generateJson` take a `backend` (`ollama` | `openai` | `anthropic`, defaulting to `WRITING_AGENT_BACKEND` or `ollama`) and **cascade on failure**: ollama → anthropic → openai, openai → ollama, anthropic → openai. The chosen backend, model, and any `fallback_reason` are returned to the caller and surfaced in the UI. It can spawn a local `ollama serve` into `.ollama-runtime/` if none is reachable.

`generateJson` uses `parseJsonLoose`, which strips prose/code fences around the JSON and then **repairs truncation** (the usual `max_tokens` failure) by closing open strings/brackets and walking back atom-by-atom until it parses. Prefer it over `JSON.parse` for any model output.

### Essay agent harness (`services/essayAgent.js`, `routes/essayAgent.js`)

The largest and most intricate subsystem (~2400 lines). It is a plan→retrieve→draft→evaluate loop over the user's own library, **persisted as JSON files under `.essay-agent/sessions/`, not in Supabase**.

One `runEssayAgentTurn`:
1. the `/clear` slash command short-circuits, wiping memory/trace/proposals but keeping sources and the approved draft
2. old transcript entries fold into a rolling summary past `TRANSCRIPT_SUMMARY_TRIGGER`
3. `planEssayTurn` — LLM returns `{phase, response_mode, tool_calls, draft_goal, style_directives, memory_patch, create_tool}`
4. **loop detection** (`detectLoopInActions` over `action_history`): if the same tool+query keeps repeating, tool calls are dropped and the harness is forced to draft with acknowledged gaps
5. execute tools (max `MAX_TOOL_STEPS`), results cached per session by tool+args
6. `reflectOnToolAdequacy` may mint a **custom tool** into `session.tool_registry`, callable by name on later turns
7. `buildEvidencePacket` → `draftEssayResponse`
8. quality review, only after turn 2 and >200 chars of draft: `critiqueDraftQuality` and `evaluateDraftQuality` run in parallel
9. merge memory, apply draft or stage proposals, compact memory on cadence, `saveSession`

Built-in tools: `search_library`, `read_book`, `read_document`, `inspect_wiki`, `compare_books`.

**Proposal mode:** when a draft already exists and the user hasn't authorised a direct rewrite, the turn returns `pending_draft_updates` instead of mutating `draft_markdown`. The user resolves each via `POST /session/:id/proposals/:proposalId` with `accept` | `reject` | `revise` (+ `feedback`). Anything that writes to the draft must respect this gate.

### Writing quality gate (`services/writingQuality.js`)

`ESSAY_QUALITY_SYSTEM_PROMPT` is the prose contract injected into essay prompts (continuous argumentative prose, no bullets, no fragments). `normalizeEssayProse` mechanically folds stray list markers back into paragraphs and adds missing terminal punctuation. `normalizeEvaluationReport` merges the LLM's self-scores with deterministic regex findings — **the model can veto-fail its own draft but can never grant a pass the mechanical gate denies**. Keep that asymmetry intact when editing scoring.

## Key conventions

- Routes follow: `req.body` → Supabase fetch for context → LLM call → Supabase insert → `res.json()`
- Supabase insert failures in `routes/distill.js` are non-fatal — ideas are returned to the client even if persistence fails
- `notes` has a unique constraint on `(book_id, chapter_name)`; `articles` on `(book_id, url)` — upsert accordingly
- `ideas.number` is computed as existing-count + insertion index, not DB-generated
- `openai.js` uses `response_format: { type: 'json_object' }`; parsers tolerate several top-level shapes (`[]`, `{insights}`, `{ideas}`, `{cards}`)
- `supabase_schema.sql` is append-only in practice and defines a few tables twice — for existing deployments apply changes with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` rather than re-running the file

## Environment variables (`.env`)

```
OPENAI_API_KEY              # gpt-4o (legacy path + fallback)
ANTHROPIC_API_KEY           # optional, essay agent backend
SERPER_API_KEY              # Google search via serper.dev
SUPABASE_URL
SUPABASE_ANON_KEY           # handed to the browser via /api/auth/config
SUPABASE_SERVICE_ROLE_KEY   # server-only, bypasses RLS, required at boot
ALLOWED_EMAIL               # the single account permitted to sign in
PORT                        # defaults to 3000, auto-increments if in use
WRITING_AGENT_BACKEND       # ollama | openai | anthropic (default ollama)
OLLAMA_BASE_URL / OLLAMA_MODEL / OLLAMA_TIMEOUT_MS
OPENAI_MODEL / ANTHROPIC_MODEL
```

## Git / deployment rules

- **Only commit files required to run the app in production:** `server.js`, `index.html`, `package.json`, `package-lock.json`, `routes/*.js`, `services/*.js`, `middleware/*.js`, `tests/*.js`, `supabase_schema.sql`, `.env.example`, `CLAUDE.md`. Never commit personal documents (`.docx`, `.pdf`, `.png`), planning files (`FEATURE_ROADMAP.md`, `IMPLEMENTATION_SUMMARY.md`, `RESUME_HERE.md`, `SETUP_GUIDE.md`, `HANDOVER.md`, `MASTERMIND_*.md`, `SKILL.md`), or runtime state (`.essay-agent/`, `.ollama-runtime/`, `*.log`).
- **Never create README or documentation files** after building a feature unless explicitly asked.
- Push to `origin master` after each confirmed feature completion.
