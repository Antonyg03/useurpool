# UseUrPool

Pick the best champion from **your own pool** against the enemy laner (League of Legends, Solo Queue).

## Status

- **Phase 1 (this)**: Riot ID (no login), main vs training account, champion pool per role with
  comfort tiers (S/A/B/C + situational + notes), training list with practice need.
- Phase 2: own games via Riot API · Phase 3: pick phase · Phase 4: matchup view · Phase 5: extras.

## Stack

Next.js (App Router) on Vercel · Supabase (Postgres) · Champion data from Riot Data Dragon.

## Setup

1. Supabase → SQL Editor → run [`supabase/schema.sql`](supabase/schema.sql).
2. Vercel → project → Settings → Environment Variables:
   - `SUPABASE_URL` = your Supabase project URL
   - `SUPABASE_SECRET_KEY` = Supabase **secret** key (server only, never commit it)
   - `RIOT_API_KEY` = Riot key (from phase 2)
3. Redeploy.

Without the Supabase variables the site still works and saves to the browser's localStorage.

Local dev: `cp .env.example .env.local`, fill in, `npm install`, `npm run dev`.

See [docs/DATA_MODEL.md](docs/DATA_MODEL.md) for the data model and what later phases add.

---

UseUrPool isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or
anyone officially involved in producing or managing Riot Games properties. Riot Games, and all
associated properties are trademarks or registered trademarks of Riot Games, Inc.
