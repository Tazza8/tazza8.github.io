-- Run this once in your Supabase project's SQL editor (Database > SQL Editor).
-- One row per signed-in user, holding their entire app state as JSON —
-- this mirrors the shape already used in localStorage (see defaultState()
-- in app.js), so the app's rendering code doesn't need to change.

create table if not exists public.gymtracker_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Row Level Security is what actually keeps one user's data private from
-- another — it's enforced by Postgres on every request, regardless of what
-- the client sends. This must stay enabled.
alter table public.gymtracker_data enable row level security;

create policy "Users manage their own data"
  on public.gymtracker_data
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- RLS restricts *which rows* a role can touch, but Postgres still requires
-- the role to be granted access to the table at all. Only signed-in users
-- (the `authenticated` role) should ever reach this table — intentionally
-- not granting anything to `anon`, so a request with no session is rejected
-- outright rather than relying on RLS alone.
grant select, insert, update, delete on public.gymtracker_data to authenticated;

-- Keeps updated_at accurate on every write.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger gymtracker_data_set_updated_at
  before update on public.gymtracker_data
  for each row
  execute function public.set_updated_at();
