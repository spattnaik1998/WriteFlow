# WriteFlow — Idea Distillation Engine

> Turn rough book notes into crystallised insights with your AI reading partner.

---

## Setup (5 minutes)

### 1. API Keys — create your `.env` file

```bash
cp .env.example .env
```

Open `.env` and fill in:

```
OPENAI_API_KEY=sk-...          # Your OpenAI key
SERPER_API_KEY=...             # From serper.dev
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
PORT=3000
```

### 2. Set up your Supabase database

1. Go to your Supabase project → **SQL Editor**
2. Paste the contents of `supabase_schema.sql` and run it
3. All 6 tables will be created (books, notes, ideas, articles, conversations, essays)

### 3. Install dependencies & run

```bash
npm install
npm start          # production
npm run dev        # with auto-reload (requires nodemon)
```

Open **http://localhost:3000** — that's it.

---

## Features

| Feature | How it works |
|---------|-------------|
| **My Library** | Add books with title, author, category, and your reading intention |
| **Notes** | Dump raw notes per chapter — no formatting needed |
| **Distill Ideas** | Sends notes to GPT-4o, returns structured insight cards |
| **Reading Partner** | Conversational AI grounded in your specific notes and ideas |
| **Find Articles** | Searches Google via Serper for relevant blog posts |
| **Write** | Compose your synthesis essay; AI can suggest continuations |
| **Export** | Download as Markdown or print to PDF |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + 1` | Notes tab |
| `Ctrl/Cmd + 2` | Ideas tab |
| `Ctrl/Cmd + 3` | Write tab |
| `Enter` | Send chat message |
| `Shift + Enter` | New line in chat |
| `Escape` | Close modal |

---

## Architecture

```
index.html      — full frontend (no framework, works offline as prototype)
server.js       — Express API server
routes/         — books, notes, distill, search, chat
services/       — openai.js, serper.js, supabase.js
```

The frontend **works immediately** in prototype mode (with sample data) even without a backend running. It auto-detects the backend via `/api/health` and switches to live mode when available.

---

## AI Models Used

- **Distil Ideas**: `gpt-4o` — structured JSON output, 3-5 insight cards per chapter
- **Reading Partner**: `gpt-4o` — grounded in your notes, conversational
- **Writing Suggestions**: `gpt-4o` — continues your essay in your voice
