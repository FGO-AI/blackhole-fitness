-- Blackhole Fitness — Supabase account sync schema
-- Run this ONCE in your Supabase project's SQL Editor (Dashboard → SQL Editor).
--
-- One JSONB row per user mirrors the app's "save the whole state blob" pattern.
-- Row Level Security is what makes this safe: Postgres itself guarantees a user
-- can only ever read or write the row whose user_id matches their auth.uid(),
-- no matter what the client-side code does.

create table if not exists public.app_data (
  user_id    uuid references auth.users(id) on delete cascade primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_data enable row level security;

-- A user may only touch their own row. One policy per operation the app
-- performs: select (pull on sign-in), insert + update (the upsert on save),
-- and delete ("Clear my data"). With RLS on, an operation with NO matching
-- policy silently affects zero rows — so a missing delete policy would make
-- "Clear my data" wipe local storage while leaving the cloud row behind.
-- (dropped first so this whole script is safe to re-run — Postgres has no
--  "create policy if not exists")
drop policy if exists "select own row" on public.app_data;
drop policy if exists "insert own row" on public.app_data;
drop policy if exists "update own row" on public.app_data;
drop policy if exists "delete own row" on public.app_data;

create policy "select own row" on public.app_data for select
  using (auth.uid() = user_id);
create policy "insert own row" on public.app_data for insert
  with check (auth.uid() = user_id);
create policy "update own row" on public.app_data for update
  using (auth.uid() = user_id);
create policy "delete own row" on public.app_data for delete
  using (auth.uid() = user_id);

-- Keep updated_at fresh on every write.
create or replace function public.touch_app_data_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

drop trigger if exists trg_touch_app_data on public.app_data;
create trigger trg_touch_app_data before update on public.app_data
  for each row execute function public.touch_app_data_updated_at();
