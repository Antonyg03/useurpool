-- UseUrPool database schema (phase 1).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to run again (uses "if not exists").
--
-- Access model: Row Level Security is ON and there are NO policies, so the
-- public anon/publishable key can read/write nothing. Only the website's
-- server (with the secret key, stored in Vercel) talks to these tables.

create table if not exists public.players (
  id            uuid primary key default gen_random_uuid(),
  -- normalized "gamename#tag@region", used for lookups
  riot_key      text not null unique,
  game_name     text not null,
  tag_line      text not null,
  region        text not null default 'euw1',
  -- filled in phase 2 via Riot API (account-v1)
  puuid         text unique,
  account_type  text not null default 'main'
                check (account_type in ('main', 'training')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.pool_entries (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.players(id) on delete cascade,
  role          text not null check (role in ('top', 'jungle', 'mid', 'bot', 'support')),
  champion_id   text not null,               -- Data Dragon id, e.g. 'Ornn'
  comfort_tier  text not null default 'B' check (comfort_tier in ('S', 'A', 'B', 'C')),
  situational   boolean not null default false,
  practice_need text check (practice_need in ('high', 'medium', 'some', 'almost_done')),
  note          text not null default '',
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  unique (player_id, role, champion_id)
);

create index if not exists pool_entries_player_idx on public.pool_entries (player_id);

alter table public.players      enable row level security;
alter table public.pool_entries enable row level security;

-- Auto-grant is disabled on this project, so grant the server role explicitly.
grant select, insert, update, delete on public.players, public.pool_entries to service_role;

-- ---------------------------------------------------------------------------
-- Planned for later phases (not created yet), see docs/DATA_MODEL.md:
--   matches / match_participants   own games imported via Riot API (phase 2)
--   matchup_notes                  your notes per champion vs enemy (phase 4)
--   collected_games                compact Master+ EUW/KR rows from the collector
--   matchup_stats                  aggregated winrates per patch/region/role
--   pro_games                      Oracle's Elixir import (LPL/LCK/LEC/LCS)

alter table public.players add column if not exists last_import_at timestamptz;

create table if not exists public.player_games (
  puuid                 text not null,
  match_id              text not null,
  played_at             timestamptz not null,
  duration_s            integer not null,
  patch                 text not null,
  role                  text,                 -- top/jungle/mid/bot/support (null if unknown)
  champion_id           text not null,        -- Data Dragon-style id from match-v5 championName
  opponent_champion_id  text,                 -- enemy laner (same position), null if unknown
  win                   boolean not null,
  remake                boolean not null default false,
  kills                 smallint not null,
  deaths                smallint not null,
  assists               smallint not null,
  cs                    smallint not null,
  gold                  integer not null,
  primary key (puuid, match_id)
);

create index if not exists player_games_puuid_played_idx on public.player_games (puuid, played_at desc);

alter table public.player_games enable row level security;
grant select, insert, update, delete on public.player_games to service_role;

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
