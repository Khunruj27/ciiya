-- Distributed, fixed-window rate limiting backed by Postgres so it holds across
-- serverless instances (an in-memory Map per instance does not). One row per
-- limiter key (e.g. "verify-password:<ip>"); check_rate_limit atomically bumps
-- the window's counter and reports whether the caller is under the limit.

create table if not exists public.rate_limits (
  key text primary key,
  count integer not null default 0,
  window_start timestamptz not null default now()
);

-- Supports the periodic cleanup of expired windows.
create index if not exists rate_limits_window_start_idx
  on public.rate_limits (window_start);

alter table public.rate_limits enable row level security;
-- No policies: only the service role (which bypasses RLS and is server-only)
-- ever touches this table, via the function below.
revoke all on table public.rate_limits from anon, authenticated;

create or replace function public.check_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_count integer;
  v_window_start timestamptz;
begin
  -- Single atomic upsert: start a fresh window if the stored one has expired,
  -- otherwise increment the running count.
  insert into public.rate_limits as rl (key, count, window_start)
  values (p_key, 1, v_now)
  on conflict (key) do update
    set
      count = case
        when rl.window_start < v_now - make_interval(secs => p_window_seconds)
          then 1
        else rl.count + 1
      end,
      window_start = case
        when rl.window_start < v_now - make_interval(secs => p_window_seconds)
          then v_now
        else rl.window_start
      end
  returning rl.count, rl.window_start
    into v_count, v_window_start;

  return query
    select
      v_count <= p_limit,
      greatest(p_limit - v_count, 0),
      v_window_start + make_interval(secs => p_window_seconds);
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer)
  from anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer)
  to service_role;
