-- UseUrPool phase 3: Master+ collector (EUW + KR) and aggregated matchup stats.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
--
-- Storage stays small: we never keep full games. Each collected game only adds
-- to counters (matchup_stats, champion_stats). Seen match ids are kept for
-- ~14 days to avoid counting a game twice, then pruned.

create table if not exists public.collected_matches (
  match_id    text primary key,
  region      text not null,           -- 'euw1' | 'kr'
  played_at   timestamptz not null
);
create index if not exists collected_matches_played_idx on public.collected_matches (played_at);

-- Champion vs lane opponent, per patch / region / role.
create table if not exists public.matchup_stats (
  patch        text not null,          -- '15.23'
  region       text not null,
  role         text not null,          -- top/jungle/mid/bot/support
  champion_id  text not null,
  opponent_id  text not null,
  games        integer not null default 0,
  wins         integer not null default 0,
  -- game length buckets (for "who outscales" later)
  games_short  integer not null default 0,  -- < 25 min
  wins_short   integer not null default 0,
  games_long   integer not null default 0,  -- >= 32 min
  wins_long    integer not null default 0,
  primary key (patch, region, role, champion_id, opponent_id)
);
create index if not exists matchup_stats_opp_idx on public.matchup_stats (role, opponent_id, patch);

-- Overall champion performance per role (pick rate = games / games of all champs in that role).
create table if not exists public.champion_stats (
  patch        text not null,
  region       text not null,
  role         text not null,
  champion_id  text not null,
  games        integer not null default 0,
  wins         integer not null default 0,
  primary key (patch, region, role, champion_id)
);

-- Collector bookkeeping (which ladder player to scan next etc.).
create table if not exists public.collector_state (
  region      text primary key,
  cursor      integer not null default 0,
  updated_at  timestamptz not null default now()
);

alter table public.collected_matches enable row level security;
alter table public.matchup_stats     enable row level security;
alter table public.champion_stats    enable row level security;
alter table public.collector_state   enable row level security;
grant select, insert, update, delete on
  public.collected_matches, public.matchup_stats, public.champion_stats, public.collector_state
  to service_role;

-- Adds one batch of games atomically and only counts games not seen before.
--   matches: [{match_id, region, played_at}]
--   rows:    [{match_id, patch, region, role, champion_id, opponent_id, win, duration_s}]
--            (one row per champion per game, i.e. 10 per game)
create or replace function public.add_collected_games(matches jsonb, rows jsonb)
returns integer
language plpgsql
set search_path = public
as $$
declare
  new_ids text[];
begin
  with ins as (
    insert into collected_matches (match_id, region, played_at)
    select m->>'match_id', m->>'region', (m->>'played_at')::timestamptz
    from jsonb_array_elements(matches) m
    on conflict (match_id) do nothing
    returning match_id
  )
  select coalesce(array_agg(match_id), '{}') into new_ids from ins;

  if coalesce(array_length(new_ids, 1), 0) = 0 then
    return 0;
  end if;

  insert into matchup_stats as s
    (patch, region, role, champion_id, opponent_id, games, wins, games_short, wins_short, games_long, wins_long)
  select r->>'patch', r->>'region', r->>'role', r->>'champion_id', r->>'opponent_id',
    count(*),
    count(*) filter (where (r->>'win')::boolean),
    count(*) filter (where (r->>'duration_s')::int < 1500),
    count(*) filter (where (r->>'duration_s')::int < 1500 and (r->>'win')::boolean),
    count(*) filter (where (r->>'duration_s')::int >= 1920),
    count(*) filter (where (r->>'duration_s')::int >= 1920 and (r->>'win')::boolean)
  from jsonb_array_elements(rows) r
  where r->>'match_id' = any(new_ids) and r->>'opponent_id' is not null
  group by 1, 2, 3, 4, 5
  on conflict (patch, region, role, champion_id, opponent_id) do update set
    games       = s.games       + excluded.games,
    wins        = s.wins        + excluded.wins,
    games_short = s.games_short + excluded.games_short,
    wins_short  = s.wins_short  + excluded.wins_short,
    games_long  = s.games_long  + excluded.games_long,
    wins_long   = s.wins_long   + excluded.wins_long;

  insert into champion_stats as s (patch, region, role, champion_id, games, wins)
  select r->>'patch', r->>'region', r->>'role', r->>'champion_id',
    count(*), count(*) filter (where (r->>'win')::boolean)
  from jsonb_array_elements(rows) r
  where r->>'match_id' = any(new_ids)
  group by 1, 2, 3, 4
  on conflict (patch, region, role, champion_id) do update set
    games = s.games + excluded.games,
    wins  = s.wins  + excluded.wins;

  return array_length(new_ids, 1);
end;
$$;

revoke execute on function public.add_collected_games(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.add_collected_games(jsonb, jsonb) to service_role;

-- Patches we have data for (newest first is sorted in the app, "15.9" < "15.23").
create or replace view public.stat_patches as
  select patch, region, sum(games)::integer as games
  from public.champion_stats
  where role = 'top'
  group by patch, region;
grant select on public.stat_patches to service_role;
revoke all on public.stat_patches from anon, authenticated;
