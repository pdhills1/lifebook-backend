-- =====================================================================
-- My Story - database setup.  Paste this whole file into Supabase
-- (SQL Editor -> New query -> Run).  Safe to run again at any time.
--
-- Security model: the website never talks to the database directly.
-- Only the server (using the secret key) does.  So row-level security is
-- switched ON with no policies, and all access is revoked from the public
-- roles - nobody with the public key can read anything.
-- =====================================================================

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null,
  email         text,
  role          text not null default 'author' check (role in ('author','admin')),
  created_at    timestamptz not null default now()
);

create table if not exists public.books (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references public.profiles(id) on delete cascade,
  title             text not null default 'My Story',
  status            text not null default 'in_progress' check (status in ('in_progress','finished')),
  finished_at       timestamptz,
  skipped_chapters  text[] not null default '{}',
  pdf_status        text,
  pdf_error         text,
  pdf_storage_path  text,
  pdf_is_final      boolean not null default false,
  pdf_requested_at  timestamptz,
  pdf_built_at      timestamptz,
  pdf_emailed_at    timestamptz,
  last_active_at    timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists books_one_per_owner on public.books(owner_id);

create table if not exists public.entries (
  id            uuid primary key default gen_random_uuid(),
  book_id       uuid not null references public.books(id) on delete cascade,
  chapter_id    text not null,
  person_name   text,
  relationship  text,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists entries_book_chapter on public.entries(book_id, chapter_id);

create table if not exists public.answers (
  id                  uuid primary key default gen_random_uuid(),
  entry_id            uuid not null references public.entries(id) on delete cascade,
  question_id         text not null,
  answer_text         text,
  photo_storage_path  text,
  photo_caption       text,
  updated_at          timestamptz not null default now(),
  unique (entry_id, question_id)
);
create index if not exists answers_entry on public.answers(entry_id);

create table if not exists public.bonus_photos (
  id                  uuid primary key default gen_random_uuid(),
  entry_id            uuid not null references public.entries(id) on delete cascade,
  photo_storage_path  text not null,
  caption             text,
  sort_order          int not null default 0,
  created_at          timestamptz not null default now()
);
create index if not exists bonus_entry on public.bonus_photos(entry_id);

-- Upgrading from the first version of this project: remove its leaky bits.
drop view if exists public.chapter_progress;
alter table public.profiles add column if not exists email text;
alter table public.books    add column if not exists skipped_chapters text[] not null default '{}';
alter table public.books    add column if not exists pdf_status text;
alter table public.books    add column if not exists pdf_error text;
alter table public.books    add column if not exists pdf_is_final boolean not null default false;
alter table public.books    add column if not exists pdf_requested_at timestamptz;
alter table public.books    add column if not exists pdf_built_at timestamptz;
alter table public.books    add column if not exists pdf_emailed_at timestamptz;
alter table public.books    add column if not exists last_active_at timestamptz;

do $$
declare p record;
begin
  for p in select schemaname, tablename, policyname from pg_policies
           where schemaname='public' and tablename in ('profiles','books','entries','answers','bonus_photos')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
  for p in select policyname from pg_policies where schemaname='storage' and tablename='objects'
           and policyname in ('Users can read their own photos','Users can upload their own photos','Users can update their own photos',
             'Users can delete their own photos','Admins can read all photos','Users can read their own finished PDF','Admins can read all PDFs')
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;

alter table public.profiles     enable row level security;
alter table public.books        enable row level security;
alter table public.entries      enable row level security;
alter table public.answers      enable row level security;
alter table public.bonus_photos enable row level security;

revoke all on public.profiles, public.books, public.entries, public.answers, public.bonus_photos from anon, authenticated;
grant all on public.profiles, public.books, public.entries, public.answers, public.bonus_photos to service_role;
