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
