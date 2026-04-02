-- WriteFlow — Supabase Schema
-- Run this in your Supabase SQL Editor to set up all tables

-- ===== BOOKS =====
create table if not exists books (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  author       text,
  category     text,
  why_reading  text,
  spine_color  text default '#1e3a6e',
  progress     integer default 0 check (progress between 0 and 100),
  source_type  text default 'book' check (source_type in ('book','article','paper','blog')),
  status       text default 'reading' check (status in ('to_read','reading','completed','archived')),
  source_url   text,
  finished_at  timestamptz,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- ===== NOTES (one row per chapter) =====
create table if not exists notes (
  id             uuid primary key default gen_random_uuid(),
  book_id        uuid references books(id) on delete cascade,
  chapter_name   text,
  chapter_order  integer default 0,
  content        text,
  word_count     integer generated always as (
    array_length(regexp_split_to_array(trim(content), '\s+'), 1)
  ) stored,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now(),
  unique(book_id, chapter_name)
);

-- ===== IDEA CARDS =====
create table if not exists ideas (
  id               uuid primary key default gen_random_uuid(),
  book_id          uuid references books(id) on delete cascade,
  chapter_name     text,
  title            text not null,
  body             text,
  tags             text[] default '{}',
  number           integer,
  is_manual        boolean default false,
  last_reviewed_at timestamptz,
  review_count     integer default 0,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- ===== ARGUMENTS (Argument Reconstruction Engine) =====
create table if not exists arguments (
  id                 uuid primary key default gen_random_uuid(),
  book_id            uuid references books(id) on delete cascade,
  chapter_name       text,
  primary_claim      text not null,
  premises           jsonb default '[]',
  conclusions        jsonb default '[]',
  logical_gaps       jsonb default '[]',
  counter_arguments  jsonb default '[]',
  metadata           jsonb default '{}',
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  unique(book_id, chapter_name)
);

-- ===== CONCEPT MAPS (Concept Map Generator) =====
create table if not exists concept_maps (
  id              uuid primary key default gen_random_uuid(),
  book_id         uuid references books(id) on delete cascade,
  chapter_name    text,
  concepts        jsonb default '[]',
  relationships   jsonb default '[]',
  hierarchy       jsonb default '[]',
  metadata        jsonb default '{}',
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique(book_id, chapter_name)
);

-- ===== ARTICLES (blog discoveries) =====
create table if not exists articles (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid references books(id) on delete cascade,
  title      text,
  url        text,
  domain     text,
  snippet    text,
  favicon    text,
  stance     text default 'neutral' check (stance in ('supporting', 'opposing', 'neutral')),
  created_at timestamptz default now(),
  unique(book_id, url)
);

-- ===== CONTRADICTIONS =====
create table if not exists contradictions (
  id                 uuid primary key default gen_random_uuid(),
  book_id            uuid references books(id) on delete cascade,
  idea_a_id          uuid references ideas(id) on delete cascade,
  idea_b_id          uuid references ideas(id) on delete cascade,
  contradiction_type text check (contradiction_type in
    ('direct_conflict', 'incompatible_premises', 'scope_mismatch')),
  description        text,
  severity           float default 0.5,
  resolution_options jsonb default '[]',
  status             text default 'unresolved'
    check (status in ('unresolved', 'resolved', 'accepted_tension')),
  created_at         timestamptz default now()
);
create unique index if not exists contradictions_pair
  on contradictions (idea_a_id, idea_b_id);

-- ===== CONVERSATIONS =====
create table if not exists conversations (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid references books(id) on delete cascade,
  role       text check (role in ('user', 'assistant')),
  content    text,
  created_at timestamptz default now()
);

-- ===== WRITTEN ESSAYS =====
create table if not exists essays (
  id         uuid primary key default gen_random_uuid(),
  book_id    uuid references books(id) on delete cascade,
  title      text,
  content    text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ===== USER PROFILE (Brand Voice — single row, id='default') =====
create table if not exists user_profile (
  id          text primary key default 'default',
  positioning text,
  audience    text,
  tone        text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ===== AUTO-UPDATE updated_at =====
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger books_updated_at before update on books
  for each row execute procedure set_updated_at();

create trigger notes_updated_at before update on notes
  for each row execute procedure set_updated_at();

create trigger essays_updated_at before update on essays
  for each row execute procedure set_updated_at();

create trigger arguments_updated_at before update on arguments
  for each row execute procedure set_updated_at();

create trigger concept_maps_updated_at before update on concept_maps
  for each row execute procedure set_updated_at();

create trigger ideas_updated_at before update on ideas
  for each row execute procedure set_updated_at();

create trigger user_profile_updated_at before update on user_profile
  for each row execute procedure set_updated_at();

-- ===== SESSIONS (writing session tracking + recap) =====
create table if not exists sessions (
  id          uuid primary key default gen_random_uuid(),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  -- activity: [{book_id, book_title, book_author, chapter_name, word_count}]
  activity    jsonb default '[]',
  -- recap: {summary, highlights, prep_question} — generated by GPT-4o on demand
  recap       jsonb,
  created_at  timestamptz default now()
);
-- Index for fast "last ended session" query
create index if not exists sessions_ended_at_idx on sessions (ended_at desc nulls last);

-- ===== MIGRATIONS (run once in Supabase SQL editor) =====
-- Add completed flag to notes (chapter mark-done feature)
alter table notes add column if not exists completed boolean default false;

-- ===== ROW LEVEL SECURITY (enable when you add auth) =====
-- alter table books        enable row level security;
-- alter table notes        enable row level security;
-- alter table ideas        enable row level security;
-- alter table articles     enable row level security;
-- alter table conversations enable row level security;
-- alter table essays       enable row level security;
