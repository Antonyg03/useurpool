import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabaseServer";
import { ROLES, type Role } from "@/lib/types";
import type { BuildRow, MatchupResponse } from "@/lib/matchupTypes";

export const dynamic = "force-dynamic";

const CHAMP_RE = /^[A-Za-z0-9]{1,32}$/;

// GET /api/matchup?role=top&champ=Ornn&enemy=Darius&region=all|euw1|kr
export async function GET(req: NextRequest) {
  const db = getSupabase();
  if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 });
  const sp = req.nextUrl.searchParams;
  const role = sp.get("role") as Role;
  const champ = sp.get("champ") ?? "";
  const enemy = sp.get("enemy") ?? "";
  const regionParam = sp.get("region") ?? "all";
  if (!(ROLES as readonly string[]).includes(role) || !CHAMP_RE.test(champ) || !CHAMP_RE.test(enemy)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const regions = regionParam === "euw1" || regionParam === "kr" ? [regionParam] : ["euw1", "kr"];

  try {
    const { data: patchRows, error: pe } = await db.from("stat_patches").select("patch").in("region", regions);
    if (pe) throw new Error(pe.message);
    const patches = [...new Set((patchRows ?? []).map((r) => r.patch as string))]
      .sort((a, b) => {
        const [a1, a2] = a.split(".").map(Number);
        const [b1, b2] = b.split(".").map(Number);
        return b1 - a1 || b2 - a2;
      })
      .slice(0, 3);

    const body: MatchupResponse = {
      patches,
      stats: { games: 0, wins: 0, gamesShort: 0, winsShort: 0, gamesLong: 0, winsLong: 0 },
      overall: { games: 0, wins: 0 },
      early: null,
      builds: [],
    };
    if (!patches.length) return NextResponse.json(body);

    const [m, o, e, b] = await Promise.all([
      db
        .from("matchup_stats")
        .select("games, wins, games_short, wins_short, games_long, wins_long")
        .eq("role", role)
        .ilike("champion_id", champ)
        .ilike("opponent_id", enemy)
        .in("region", regions)
        .in("patch", patches),
      db
        .from("champion_stats")
        .select("games, wins")
        .eq("role", role)
        .ilike("champion_id", champ)
        .in("region", regions)
        .in("patch", patches),
      db
        .from("matchup_early")
        .select("games, wins, gold3_diff_sum, xp3_diff_sum, fb_for, fb_against")
        .eq("role", role)
        .ilike("champion_id", champ)
        .ilike("opponent_id", enemy)
        .in("region", regions)
        .in("patch", patches),
      db.rpc("get_builds", { p_role: role, p_champion: champ, p_opponent: enemy, p_patches: patches }),
    ]);
    if (m.error) throw new Error(m.error.message);
    if (o.error) throw new Error(o.error.message);

    for (const r of m.data ?? []) {
      body.stats.games += r.games;
      body.stats.wins += r.wins;
      body.stats.gamesShort += r.games_short;
      body.stats.winsShort += r.wins_short;
      body.stats.gamesLong += r.games_long;
      body.stats.winsLong += r.wins_long;
    }
    for (const r of o.data ?? []) {
      body.overall.games += r.games;
      body.overall.wins += r.wins;
    }
    // Phase 4 tables may not exist yet: treat errors there as "no data".
    if (!e.error && e.data?.length) {
      const s = e.data.reduce(
        (a, r) => ({
          games: a.games + r.games,
          wins: a.wins + r.wins,
          gold: a.gold + Number(r.gold3_diff_sum),
          xp: a.xp + Number(r.xp3_diff_sum),
          fbFor: a.fbFor + r.fb_for,
          fbAgainst: a.fbAgainst + r.fb_against,
        }),
        { games: 0, wins: 0, gold: 0, xp: 0, fbFor: 0, fbAgainst: 0 },
      );
      if (s.games) {
        body.early = {
          games: s.games,
          wins: s.wins,
          gold3: s.gold / s.games,
          xp3: s.xp / s.games,
          fbFor: s.fbFor / s.games,
          fbAgainst: s.fbAgainst / s.games,
        };
      }
    }
    if (!b.error && Array.isArray(b.data)) {
      body.builds = (b.data as BuildRow[]).map((r) => ({ ...r, games: Number(r.games), wins: Number(r.wins) }));
    }
    return NextResponse.json(body, { headers: { "cache-control": "s-maxage=300" } });
  } catch (err) {
    console.error("[api/matchup]", err);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
