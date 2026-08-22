-- Wortschatz — initial schema
--
-- Paste this whole file into the Supabase dashboard: SQL Editor -> New query -> Run.
-- It is idempotent, so running it twice is harmless.
--
-- Every table mirrors the Dexie store in src/types.ts, in snake_case, and carries
-- the three sync columns: id, updated_at, deleted (soft delete, so a deletion on
-- one device propagates instead of being resurrected by the other).
--
-- Single user by design: row level security restricts every table to
-- auth.uid() = user_id, and user_id defaults to the authenticated user, so the
-- client never has to send it.

-- ---------------------------------------------------------------- tables

create table if not exists public.words (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  lemma         text not null,
  pos           text not null check (pos in ('noun','verb','adj','adv','phrase','other')),
  gender        text check (gender in ('m','f','n')),
  article       text check (article in ('der','die','das')),
  plural        text,
  translations  jsonb not null default '[]'::jsonb,
  verb_props    jsonb,
  context_sentence text,
  source_note   text,
  freq_rank     integer,
  tags          jsonb not null default '[]'::jsonb,
  unresolved    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted       boolean not null default false
);

create table if not exists public.cards (
  id             uuid primary key,
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  word_id        uuid not null,
  direction      text not null check (direction in ('de-en','en-de')),
  due            timestamptz not null,
  stability      double precision not null default 0,
  difficulty     double precision not null default 0,
  elapsed_days   double precision not null default 0,
  scheduled_days double precision not null default 0,
  learning_steps integer not null default 0,
  reps           integer not null default 0,
  lapses         integer not null default 0,
  state          smallint not null default 0 check (state between 0 and 3),
  last_review    timestamptz,
  sibling_due_at timestamptz,
  updated_at     timestamptz not null default now(),
  deleted        boolean not null default false
);

create table if not exists public.review_log (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  card_id      uuid not null,
  word_id      uuid not null,
  rating       smallint not null check (rating between 1 and 4),
  reviewed_at  timestamptz not null,
  state_before smallint not null,
  state_after  smallint not null,
  duration_ms  integer,
  updated_at   timestamptz not null default now(),
  deleted      boolean not null default false
);

create table if not exists public.grammar_topics (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  slug       text not null,
  title      text not null,
  level      text not null check (level in ('A1','A2','B1','B2','C1')),
  theory_md  text not null,
  status     text not null default 'curated' check (status in ('curated','generated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false,
  unique (user_id, slug)
);

create table if not exists public.exercises (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  topic_slug text,
  type       text not null check (type in ('cloze','article','word_order','conjugation','translate','multiple_choice')),
  payload    jsonb not null,
  source     text not null default 'template' check (source in ('template','coach')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false
);

create table if not exists public.exercise_attempts (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  exercise_id text not null,
  topic_slug  text,
  correct     boolean not null,
  answered_at timestamptz not null,
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);

create table if not exists public.coach_requests (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  kind        text not null check (kind in ('grammar_topic','suggestions','weekly_exam','word_research')),
  payload     jsonb not null default '{}'::jsonb,
  status      text not null default 'pending' check (status in ('pending','done','failed')),
  result      jsonb,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false
);

create table if not exists public.suggestions (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  lemma        text not null,
  gender       text check (gender in ('m','f','n')),
  translations jsonb not null default '[]'::jsonb,
  reason       text not null,
  related_to   jsonb not null default '[]'::jsonb,
  status       text not null default 'new' check (status in ('new','accepted','dismissed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted      boolean not null default false
);

create table if not exists public.exams (
  id         uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  iso_week   text not null,
  items      jsonb not null default '[]'::jsonb,
  score      integer,
  taken_at   timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false,
  unique (user_id, iso_week)
);

-- ---------------------------------------------------------------- indexes

-- Sync pulls "everything changed since X", so updated_at is the hot column.
create index if not exists words_sync_idx             on public.words (user_id, updated_at);
create index if not exists cards_sync_idx             on public.cards (user_id, updated_at);
create index if not exists review_log_sync_idx        on public.review_log (user_id, updated_at);
create index if not exists grammar_topics_sync_idx    on public.grammar_topics (user_id, updated_at);
create index if not exists exercises_sync_idx         on public.exercises (user_id, updated_at);
create index if not exists exercise_attempts_sync_idx on public.exercise_attempts (user_id, updated_at);
create index if not exists coach_requests_sync_idx    on public.coach_requests (user_id, updated_at);
create index if not exists suggestions_sync_idx       on public.suggestions (user_id, updated_at);
create index if not exists exams_sync_idx             on public.exams (user_id, updated_at);

-- The coach reads pending work and word analytics on every run.
create index if not exists coach_requests_pending_idx on public.coach_requests (user_id, status) where status = 'pending';
create index if not exists cards_word_idx             on public.cards (user_id, word_id);
create index if not exists review_log_word_idx        on public.review_log (user_id, word_id);

-- ---------------------------------------------------------------- RLS

do $$
declare
  t text;
begin
  foreach t in array array[
    'words','cards','review_log','grammar_topics','exercises',
    'exercise_attempts','coach_requests','suggestions','exams'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);

    -- One policy covering all four verbs: you may only ever touch your own rows,
    -- and you may not write a row that would belong to someone else.
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format($f$
      create policy %I on public.%I
        for all
        to authenticated
        using (auth.uid() = user_id)
        with check (auth.uid() = user_id)
    $f$, t || '_owner', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------- grants
--
-- RLS decides *which rows* a role may touch; table GRANTs decide whether it may
-- touch the table at all. Both are required. Newer Supabase projects do not
-- automatically grant new public tables to the API roles, so do it explicitly
-- rather than depending on the project's default privileges.

grant usage on schema public to anon, authenticated, service_role;

-- The app signs in as `authenticated`; RLS then restricts it to its own rows.
grant select, insert, update, delete on all tables in schema public to authenticated;

-- `service_role` bypasses RLS and is used only by the /coach command.
grant select, insert, update, delete on all tables in schema public to service_role;

-- Anything added later inherits the same shape.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;

-- The anon role gets nothing: this app has no public signup and no public data.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
