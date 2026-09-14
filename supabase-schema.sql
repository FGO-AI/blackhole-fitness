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
-- The with check below is explicit rather than implied. Postgres already
-- applies an update policy's using expression to the new row when with check
-- is omitted, so this changes nothing today; it is here so that a later edit
-- loosening using (to share rows, say) cannot silently loosen the write check
-- along with it.
create policy "update own row" on public.app_data for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
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

-- ── Free-text goal intake: per-user rate limit ──────────────────────
-- The parse-goal Edge Function proxies a paid API from a public app, so an
-- uncapped endpoint is a billing incident waiting to happen. The counter lives
-- in Postgres rather than in the function because Edge Functions are stateless
-- and several instances can run at once — only the database can make "read the
-- count, then increment it" atomic.

create table if not exists public.parse_goal_calls (
  user_id      uuid references auth.users(id) on delete cascade primary key,
  window_start timestamptz not null default now(),
  calls        integer     not null default 0
);

alter table public.parse_goal_calls enable row level security;
-- No policies, deliberately. With RLS on and no policy, every direct read or
-- write from a client touches zero rows. The only way in is the security
-- definer function below, which owns the increment — a user must not be able
-- to reset their own counter, and the limit is not a parameter they can pass.

create or replace function public.claim_parse_goal_call()
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  hourly_limit constant integer  := 10;
  win          constant interval := interval '1 hour';
  uid          uuid := auth.uid();
  rec          public.parse_goal_calls%rowtype;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- One statement, so two concurrent calls cannot both read the old count:
  -- the first takes the row lock and the second waits for it. Both CASE arms
  -- see the pre-update row, which is what makes the window roll cleanly.
  insert into public.parse_goal_calls as c (user_id, window_start, calls)
  values (uid, now(), 1)
  on conflict (user_id) do update
    set window_start = case when now() - c.window_start >= win then now()
                            else c.window_start end,
        calls        = case when now() - c.window_start >= win then 1
                            else c.calls + 1 end
  returning * into rec;

  return query select rec.calls <= hourly_limit,
                      greatest(hourly_limit - rec.calls, 0),
                      rec.window_start + win;
end;
$$;

revoke all on function public.claim_parse_goal_call() from public;
grant execute on function public.claim_parse_goal_call() to authenticated;
