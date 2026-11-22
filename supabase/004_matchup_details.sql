-- UseUrPool phase 4: matchup details (early game, builds) + your notes + feedback.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.

-- Early game per matchup, from match timelines (only a sample of games has a timeline).
create table if not exists public.matchup_early (
  patch          text not null,
  region         text not null,
  role           text not null,
  champion_id    text not null,
  opponent_id    text not null,
  games          integer not null default 0,
  wins           integer not null default 0,
  gold3_diff_sum bigint  not null default 0,  -- sum of (my gold - lane opponent gold) at 3:00
  xp3_diff_sum   bigint  not null default 0,
  fb_for         integer not null default 0,  -- I killed my lane opponent first, before 4:00
  fb_against     integer not null default 0,  -- my lane opponent killed me first, before 4:00
  primary key (patch, region, role, champion_id, opponent_id)
);

-- Builds per matchup: one counter per (kind, value). Regions combined to stay small;
-- only the newest patches are kept (see prune_build_stats).
--   kind: keystone | runes (keystone:secondary tree) | start (starting items)
--         | items (first two finished items, in order) | skill_start (first 3 levels) | skill_max
create table if not exists public.build_stats (
  patch        text not null,
  role         text not null,
  champion_id  text not null,
  opponent_id  text not null,
  kind         text not null,
  value        text not null,
  games        integer not null default 0,
  wins         integer not null default 0,
  primary key (patch, role, champion_id, opponent_id, kind, value)
);
create index if not exists build_stats_champ_idx on public.build_stats (role, champion_id, patch);

-- Your own notes per matchup (shown on top of the matchup page).
create table if not exists public.matchup_notes (
  player_id    uuid not null references public.players(id) on delete cascade,
  role         text not null,
  champion_id  text not null,
  opponent_id  text not null,
  note         text not null default '',
  updated_at   timestamptz not null default now(),
  primary key (player_id, role, champion_id, opponent_id)
);

-- "Was this helpful?" feedback from the matchup page.
create table if not exists public.feedback (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid references public.players(id) on delete set null,
  role         text,
  champion_id  text,
  opponent_id  text,
  helpful      boolean,
  comment      text not null default '',
  created_at   timestamptz not null default now()
);

alter table public.matchup_early enable row level security;
alter table public.build_stats   enable row level security;
alter table public.matchup_notes enable row level security;
alter table public.feedback      enable row level security;
grant select, insert, update, delete on
  public.matchup_early, public.build_stats, public.matchup_notes, public.feedback
  to service_role;

-- Replaces the phase 3 version: same, plus early-game and build rows.
drop function if exists public.add_collected_games(jsonb, jsonb);

-- matches: [{match_id, region, played_at}]
-- rows:    [{match_id, patch, region, role, champion_id, opponent_id, win, duration_s}]
-- early:   [{match_id, patch, region, role, champion_id, opponent_id, win, gold3_diff, xp3_diff, fb_for, fb_against}]
-- builds:  [{match_id, patch, role, champion_id, opponent_id, kind, value, win}]
create or replace function public.add_collected_games(
  matches jsonb, rows jsonb, early jsonb default '[]', builds jsonb default '[]'
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

  return array_length(new_ids, 1);
end;
$$;

revoke execute on function public.add_collected_games(jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.add_collected_games(jsonb, jsonb, jsonb, jsonb) to service_role;

-- Builds for one matchup, plus the same champion against everyone (fallback when
-- the matchup has few games).
create or replace function public.get_builds(p_role text, p_champion text, p_opponent text, p_patches text[])
returns table (scope text, kind text, value text, games bigint, wins bigint)
language sql
stable
set search_path = public
as $$
  select 'matchup', kind, value, sum(games), sum(wins)
  from build_stats
  where role = p_role and champion_id ilike p_champion and opponent_id ilike p_opponent and patch = any(p_patches)
  group by kind, value
  union all
  select 'champion', kind, value, sum(games), sum(wins)
  from build_stats
  where role = p_role and champion_id ilike p_champion and patch = any(p_patches)
  group by kind, value
$$;
revoke execute on function public.get_builds(text, text, text, text[]) from public, anon, authenticated;
grant execute on function public.get_builds(text, text, text, text[]) to service_role;

-- Keeps build_stats small: only the newest `keep` patches stay.
create or replace function public.prune_build_stats(keep integer default 3)
returns integer
language plpgsql
set search_path = public
as $$
declare
  removed integer;
begin
  with recent as (
    select patch from (select distinct patch from build_stats) p
    order by split_part(patch, '.', 1)::int desc, split_part(patch, '.', 2)::int desc
    limit keep
  )
  delete from build_stats where patch not in (select patch from recent);
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke execute on function public.prune_build_stats(integer) from public, anon, authenticated;
grant execute on function public.prune_build_stats(integer) to service_role;
