-- UseUrPool: Pro Play column, one-trick (OTP) data and OTP statements.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.

-- Master+ ladder players and whether they are one-tricks (from champion mastery).
create table if not exists public.otp_players (
  puuid          text primary key,
  region         text not null,
  champion_id    text,                 -- most played champion (Data Dragon id)
  top_points     integer not null default 0,
  second_points  integer not null default 0,
  is_otp         boolean not null default false,
  checked_at     timestamptz not null default now()
);
create index if not exists otp_players_region_idx on public.otp_players (region, checked_at);

-- Same as matchup_stats, but only games where the champion was played by a one-trick.
create table if not exists public.otp_matchup_stats (
  patch        text not null,
  region       text not null,
  role         text not null,
  champion_id  text not null,
  opponent_id  text not null,
  games        integer not null default 0,
  wins         integer not null default 0,
  primary key (patch, region, role, champion_id, opponent_id)
);
create index if not exists otp_matchup_opp_idx on public.otp_matchup_stats (role, opponent_id, patch);

-- Statements from one-tricks you collect by hand (e.g. from a stream or guide).
create table if not exists public.otp_notes (
  id           uuid primary key default gen_random_uuid(),
  role         text not null,
  champion_id  text not null,
  opponent_id  text not null,
  text         text not null,
  source       text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists otp_notes_matchup_idx on public.otp_notes (role, champion_id, opponent_id);

-- Pro games (LPL, LCK, LEC, LCS): one row per player per game.
create table if not exists public.pro_games (
  game_id      text not null,
  role         text not null,
  champion_id  text not null,
  opponent_id  text,
  league       text not null,
  patch        text not null,
  game_date    timestamptz not null,
  win          boolean not null,
  primary key (game_id, role, champion_id)
);
create index if not exists pro_games_opp_idx on public.pro_games (role, opponent_id);

-- Reworked champions: pro data from before `since_patch` is ignored.
create table if not exists public.champion_resets (
  champion_id  text primary key,
  since_patch  text not null,
  note         text not null default ''
);

alter table public.otp_players       enable row level security;
alter table public.otp_matchup_stats enable row level security;
alter table public.otp_notes         enable row level security;
alter table public.pro_games         enable row level security;
alter table public.champion_resets   enable row level security;
grant select, insert, update, delete on
  public.otp_players, public.otp_matchup_stats, public.otp_notes, public.pro_games, public.champion_resets
  to service_role;

-- Replaces the phase 4 version: same, plus one-trick rows.
drop function if exists public.add_collected_games(jsonb, jsonb, jsonb, jsonb);

-- otp: [{match_id, patch, region, role, champion_id, opponent_id, win}]  (only one-trick players)
create or replace function public.add_collected_games(
  matches jsonb, rows jsonb, early jsonb default '[]', builds jsonb default '[]', otp jsonb default '[]'
)
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

  insert into matchup_early as s
    (patch, region, role, champion_id, opponent_id, games, wins, gold3_diff_sum, xp3_diff_sum, fb_for, fb_against)
  select e->>'patch', e->>'region', e->>'role', e->>'champion_id', e->>'opponent_id',
    count(*),
    count(*) filter (where (e->>'win')::boolean),
    sum((e->>'gold3_diff')::int),
    sum((e->>'xp3_diff')::int),
    count(*) filter (where (e->>'fb_for')::boolean),
    count(*) filter (where (e->>'fb_against')::boolean)
  from jsonb_array_elements(early) e
  where e->>'match_id' = any(new_ids)
  group by 1, 2, 3, 4, 5
  on conflict (patch, region, role, champion_id, opponent_id) do update set
    games          = s.games          + excluded.games,
    wins           = s.wins           + excluded.wins,
    gold3_diff_sum = s.gold3_diff_sum + excluded.gold3_diff_sum,
    xp3_diff_sum   = s.xp3_diff_sum   + excluded.xp3_diff_sum,
    fb_for         = s.fb_for         + excluded.fb_for,
    fb_against     = s.fb_against     + excluded.fb_against;

  insert into build_stats as s (patch, role, champion_id, opponent_id, kind, value, games, wins)
  select b->>'patch', b->>'role', b->>'champion_id', b->>'opponent_id', b->>'kind', b->>'value',
    count(*), count(*) filter (where (b->>'win')::boolean)
  from jsonb_array_elements(builds) b
  where b->>'match_id' = any(new_ids)
  group by 1, 2, 3, 4, 5, 6
  on conflict (patch, role, champion_id, opponent_id, kind, value) do update set
    games = s.games + excluded.games,
    wins  = s.wins  + excluded.wins;

  insert into otp_matchup_stats as s (patch, region, role, champion_id, opponent_id, games, wins)
  select o->>'patch', o->>'region', o->>'role', o->>'champion_id', o->>'opponent_id',
    count(*), count(*) filter (where (o->>'win')::boolean)
  from jsonb_array_elements(otp) o
  where o->>'match_id' = any(new_ids) and o->>'opponent_id' is not null
  group by 1, 2, 3, 4, 5
  on conflict (patch, region, role, champion_id, opponent_id) do update set
    games = s.games + excluded.games,
    wins  = s.wins  + excluded.wins;

  return array_length(new_ids, 1);
end;
$$;

revoke execute on function public.add_collected_games(jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.add_collected_games(jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
