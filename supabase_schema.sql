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
  id           uuid primary key default gen_random_uuid(),
  book_id      uuid references books(id) on delete cascade,
  chapter_name text,
  title        text not null,
  body         text,
  tags         text[] default '{}',
  number       integer,
  created_at   timestamptz default now()
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
  created_at timestamptz default now(),
  unique(book_id, url)
);

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

-- ===== MIGRATIONS (run manually in SQL editor if already set up) =====
-- Add stance column for article stance classification (Cross-Library Intelligence upgrade)
-- ALTER TABLE articles
--   ADD COLUMN IF NOT EXISTS stance text DEFAULT 'neutral'
--   CHECK (stance IN ('supporting', 'opposing', 'neutral'));

-- ===== ROW LEVEL SECURITY (enable when you add auth) =====
-- alter table books        enable row level security;
-- alter table notes        enable row level security;
-- alter table ideas        enable row level security;
-- alter table articles     enable row level security;
-- alter table conversations enable row level security;
-- alter table essays       enable row level security;
