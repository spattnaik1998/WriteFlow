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

-- ===== MIGRATIONS (safe to re-run — all use IF NOT EXISTS) =====

-- !! CRITICAL: Disable RLS on all tables (app uses server-side Supabase anon key,
--    no auth yet — RLS with no policies blocks ALL reads and writes silently)
alter table books         disable row level security;
alter table notes         disable row level security;
alter table ideas         disable row level security;
alter table articles      disable row level security;
alter table conversations disable row level security;
alter table essays        disable row level security;
alter table arguments     disable row level security;
alter table concept_maps  disable row level security;
alter table contradictions disable row level security;
alter table user_profile  disable row level security;
alter table sessions      disable row level security;

-- Books: add columns that may be missing in older deployments
alter table books add column if not exists source_type  text    default 'book'    check (source_type in ('book','article','paper','blog'));
alter table books add column if not exists status       text    default 'reading' check (status in ('to_read','reading','completed','archived'));
alter table books add column if not exists source_url   text;
alter table books add column if not exists category     text;
alter table books add column if not exists why_reading  text;
alter table books add column if not exists finished_at  timestamptz;

-- Notes: chapter ordering and completion flag (may be missing in older deployments)
alter table notes add column if not exists chapter_order integer default 0;
alter table notes add column if not exists completed boolean default false;

-- Session quiz cache
alter table sessions add column if not exists quiz jsonb;

-- Arguments table: add columns that may be missing in older deployments
alter table arguments add column if not exists conclusions        jsonb default '[]';
alter table arguments add column if not exists logical_gaps       jsonb default '[]';
alter table arguments add column if not exists counter_arguments  jsonb default '[]';
alter table arguments add column if not exists metadata           jsonb default '{}';

-- Unique constraint on arguments (enables upsert by chapter)
do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'arguments_book_id_chapter_name_key'
  ) then
    alter table arguments add constraint arguments_book_id_chapter_name_key unique (book_id, chapter_name);
  end if;
end $$;

-- concept_maps table (create if not exists for older deployments)
create table if not exists concept_maps (
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid references books(id) on delete cascade,
  chapter_name  text,
  concepts      jsonb default '[]',
  relationships jsonb default '[]',
  hierarchy     jsonb default '[]',
  metadata      jsonb default '{}',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique(book_id, chapter_name)
);
create trigger if not exists concept_maps_updated_at before update on concept_maps
  for each row execute procedure set_updated_at();

-- Add summary column for book-level concept map explanation
alter table concept_maps add column if not exists summary text default '';

-- contradictions table (create if not exists for older deployments)
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
create unique index if not exists contradictions_pair on contradictions (idea_a_id, idea_b_id);

-- ===== ROW LEVEL SECURITY (enable when you add auth) =====
-- alter table books        enable row level security;
-- alter table notes        enable row level security;
-- alter table ideas        enable row level security;
-- alter table articles     enable row level security;
-- alter table conversations enable row level security;
-- alter table essays       enable row level security;

-- Analytics: add reading goal column to user_profile
alter table user_profile add column if not exists reading_goal_annual integer default 12;

-- ===== LLM WIKI =====

create table if not exists wiki_pages (
  id               uuid primary key default gen_random_uuid(),
  slug             text unique not null,
  title            text not null,
  page_type        text not null check (page_type in
                     ('entity','concept','theme','book','overview','index','log','query_answer')),
  markdown_content text not null default '',
  -- metadata shape: { source_book_ids:[], source_idea_ids:[], version:N,
  --                   prev_markdown:"", last_ingest_id:uuid, stale:false, user_edited:false }
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
create index if not exists wiki_pages_type_idx on wiki_pages (page_type);

create table if not exists wiki_links (
  id             uuid primary key default gen_random_uuid(),
  source_page_id uuid references wiki_pages(id) on delete cascade,
  target_slug    text not null,
  link_context   text,
  created_at     timestamptz default now()
);
create index if not exists wiki_links_source_idx on wiki_links (source_page_id);
create index if not exists wiki_links_target_idx on wiki_links (target_slug);

create table if not exists wiki_ingest_log (
  id             uuid primary key default gen_random_uuid(),
  op             text check (op in ('ingest_chapter','ingest_book','query','lint','manual_edit','backfill')),
  source_ref     jsonb,
  pages_touched  jsonb default '[]'::jsonb,
  tokens_used    integer,
  cost_cents     integer,
  created_at     timestamptz default now()
);

create trigger wiki_pages_updated_at before update on wiki_pages
  for each row execute procedure set_updated_at();

alter table wiki_pages      disable row level security;
alter table wiki_links      disable row level security;
alter table wiki_ingest_log disable row level security;
