-- Persistent per-account rate limits (FT-10, plan §6.2), spec 04 task 1.
-- Limits are data, revisable by migration. Windows are fixed one-hour buckets (date_bin)
-- and each bucket is one row incremented by a single atomic statement.

create table public.rate_limits (
  action text primary key check (action ~ '^[a-z_]+$'),
  max_count integer not null check (max_count > 0),
  window_seconds integer not null check (window_seconds > 0)
);

insert into public.rate_limits (action, max_count, window_seconds)
values
  ('comment', 10, 3600),
  ('report', 10, 3600),
  ('support', 60, 3600);

create table public.rate_windows (
  actor_id uuid not null references auth.users (id) on delete cascade,
  action text not null references public.rate_limits (action) on delete restrict,
  window_start timestamptz not null,
  count integer not null check (count > 0),
  primary key (actor_id, action, window_start)
);

alter table public.rate_limits enable row level security;
alter table public.rate_windows enable row level security;
revoke all on table public.rate_limits from anon, authenticated;
revoke all on table public.rate_windows from anon, authenticated;

-- Consumes one unit of an action for an actor. Raises FT429 with the seconds until the
-- next bucket in DETAIL when the bucket is full; the caller's transaction then rolls
-- back, so a rejected request leaves no side effects and consumes nothing. Called last,
-- after validation, replay, and deduplication, so replays and no-ops never consume.
-- p_now exists only so pgTAP can pin the clock; public RPCs always pass now().
create or replace function public.rate_limit_consume(
  p_actor uuid,
  p_action text,
  p_now timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer;
  v_window integer;
  v_start timestamptz;
  v_count integer;
begin
  select l.max_count, l.window_seconds
  into v_max, v_window
  from public.rate_limits as l
  where l.action = p_action;

  if v_max is null or p_actor is null or p_now is null then
    raise exception using errcode = '22023', message = 'invalid_rate_limit_request';
  end if;

  v_start := pg_catalog.date_bin(
    pg_catalog.make_interval(secs => v_window),
    p_now,
    timestamptz '2000-01-01 00:00:00+00'
  );

  insert into public.rate_windows as w (actor_id, action, window_start, count)
  values (p_actor, p_action, v_start, 1)
  on conflict (actor_id, action, window_start)
  do update set count = w.count + 1
  where w.count < v_max
  returning w.count into v_count;

  if v_count is null then
    raise exception using
      errcode = 'FT429',
      message = 'rate_limited',
      detail = greatest(
        1,
        pg_catalog.ceil(extract(epoch from (v_start + pg_catalog.make_interval(secs => v_window) - p_now)))
      )::integer::text;
  end if;

  -- Old buckets are useless after a day; keep the table small without a scheduler.
  delete from public.rate_windows as old
  where old.actor_id = p_actor
    and old.window_start < p_now - interval '24 hours';
end;
$$;

revoke all on function public.rate_limit_consume(uuid, text, timestamptz)
  from public, anon, authenticated;
