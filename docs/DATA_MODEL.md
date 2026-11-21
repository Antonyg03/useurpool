# Data model

## Phase 1 (live)

- **players**: one row per Riot account + region (`riot_key` = `name#tag@region`).
  `account_type` is `main` or `training`. `puuid` is filled once the Riot API is wired up.
- **pool_entries**: champions per player *and role* (so Top and Mid pools are separate).
  - `comfort_tier` S/A/B/C → frame colour (S rainbow, A red, B yellow, C grey)
  - `situational` + `note` → e.g. "Jax: A vs Camille, otherwise B"
  - `practice_need` → training account list (high / medium / some / almost_done)

## Later phases (planned)

| Table | Phase | Purpose |
|---|---|---|
| `matches`, `match_participants` | 2 | Own games via Riot API (match-v5), incl. old games import |
| `matchup_notes` | 2–4 | Own notes per (player, role, my champ, enemy champ) |
| `collected_games` | 2+ | Compact rows from the Master+ collector (EUW + KR, GitHub Actions) |
| `matchup_stats` | 3 | Aggregates per patch / region / role / champ vs champ, incl. gold@3, lane FB, winrate by game length |
| `pro_games` | 3 | Oracle's Elixir import, last 10 patches, LPL/LCK/LEC/LCS |

Matchup tiers are computed as **percentiles per enemy**, not fixed winrate cut-offs.
