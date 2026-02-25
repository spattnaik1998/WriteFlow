# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npm start            # run server (node server.js)
npm run dev          # run with auto-reload via nodemon
```

No test runner or linter is configured.

## Architecture

WriteFlow is a book note distillation app: users dump rough notes per chapter, and GPT-4o distils them into idea cards. An AI reading partner and blog article discovery round out the features.

**Single-server, single-file frontend pattern:**
- `server.js` — Express server that serves `index.html` as a static file AND mounts all API routes under `/api/*`
- `index.html` — entire frontend in one file (vanilla JS, embedded CSS). No build step, no framework.
- `routes/` — one file per domain: books, notes, distill, search, chat
- `services/` — thin wrappers: `openai.js` (distillNotes, chatWithPartner, suggestWriting), `supabase.js` (client), `serper.js` (Google search via Serper API)

**Prototype / live mode duality:**
The frontend boots in prototype mode with sample data. On load it calls `GET /api/health`; if that responds, it switches to live mode and all functions use real API calls. This means the frontend always works even without a running backend. Every user-facing function (sendMsg, distillIdeas, findBlogArticles) has both a prototype branch and a real API branch.

**Data flow for the core feature (distil):**
1. User selects a book → sets `CURRENT_BOOK_ID` in frontend state
2. User types/pastes notes into the Notes tab per chapter
3. "Distil Ideas" button → `POST /api/distill` with `{book_id, chapter_name, raw_notes}`
4. Route fetches book + existing ideas from Supabase for context, calls `distillNotes()` in `services/openai.js`
5. GPT-4o returns JSON array of `{title, body, tags, number}` cards; route persists to `ideas` table, returns saved rows

**Chat context assembly** (`routes/chat.js`):
Every chat message triggers parallel Supabase fetches for the book, all notes, and up to 10 idea cards. These are injected into the GPT-4o system prompt so the AI is grounded in the user's actual notes. Last 8 conversation turns are passed as message history.

## Key conventions

- All routes follow `req.body` → Supabase fetch for context → OpenAI call → Supabase insert → `res.json()` pattern
- Supabase errors on insert are non-fatal in `distill.js` — ideas are returned to the client even if persistence fails
- `notes` table has a unique constraint on `(book_id, chapter_name)` — use upsert if updating notes
- `articles` table has a unique constraint on `(book_id, url)` — prevents duplicate blog saves
- `ideas.number` is set by counting existing ideas + insertion index (not auto-incremented by DB)
- OpenAI `response_format: { type: 'json_object' }` is used for distillNotes; the raw parse handles three possible top-level shapes (`[]`, `{insights}`, `{ideas}`, `{cards}`)
- RLS is disabled on all Supabase tables — commented-out RLS setup is in `supabase_schema.sql` for when auth is added

## Environment variables (`.env`)

```
OPENAI_API_KEY      # GPT-4o access
SERPER_API_KEY      # Google search via serper.dev
SUPABASE_URL        # Supabase project URL
SUPABASE_ANON_KEY   # Supabase anon key
PORT                # defaults to 3000
```

## Database setup

Run `supabase_schema.sql` once in the Supabase SQL editor. It creates 6 tables (`books`, `notes`, `ideas`, `articles`, `conversations`, `essays`) and `updated_at` triggers for books, notes, and essays.
