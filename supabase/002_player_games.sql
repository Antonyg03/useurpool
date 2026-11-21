-- UseUrPool phase 2: own ranked games imported from the Riot API.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.

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
