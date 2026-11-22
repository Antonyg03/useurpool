# Data model

## Phase 1 (live)

- **players**: one row per Riot account + region (`riot_key` = `name#tag@region`).
  `account_type` is `main` or `training`. `puuid` is filled once the Riot API is wired up.
- **pool_entries**: champions per player *and role* (so Top and Mid pools are separate).
  - `comfort_tier` S/A/B/C → frame colour (S rainbow, A red, B yellow, C grey)
  - `situational` + `note` → e.g. "Jax: A vs Camille, otherwise B"
  - `practice_need` → training account list (high / medium / some / almost_done)

## Phase 2 (live)

- **player_games**: one compact row per (puuid, match) for Ranked Solo (queue 420): date, duration,
  patch, role, champion, lane opponent (same `teamPosition` on the enemy team), win, remake, K/D/A, CS, gold.
- `players.last_import_at` records the last import.

## Phase 3 (live)

- **collected_matches**: Master+ match ids already counted (kept 14 days, then pruned).
- **matchup_stats**: per patch/region/role/champion/opponent: games, wins, plus short (<25 min)
  and long (>=32 min) buckets for later "who outscales" checks.
- **champion_stats**: per patch/region/role/champion: games, wins (pick rate = games / (role total / 2)).
- **collector_state**: per region, which ladder player to scan next.
- `add_collected_games(matches, rows)` adds a batch atomically and skips already counted games.
- Matchup tier = percentile of the (sample-smoothed) winrate among all champions vs that enemy:
  Great >= 80th, Good >= 60th, Even >= 40th, Hard >= 20th, Avoid below.

## Later phases (planned)

| Table | Phase | Purpose |
|---|---|---|
| `matchup_notes` | 2–4 | Own notes per (player, role, my champ, enemy champ) |
| timeline stats | 4 | gold/XP @3 min, lane first blood (needs match timelines) |
| `pro_games` | 3 | Oracle's Elixir import, last 10 patches, LPL/LCK/LEC/LCS |

Matchup tiers are computed as **percentiles per enemy**, not fixed winrate cut-offs.
