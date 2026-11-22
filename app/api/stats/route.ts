import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabaseServer";
import { ROLES, type Role } from "@/lib/types";
import type { ChampAgg, StatsResponse } from "@/lib/statsTypes";

export const dynamic = "force-dynamic";

const COLLECTOR_REGIONS = ["euw1", "kr"] as const;

/**
 * GET /api/stats?role=top&region=euw1|kr|all&patches=3[&enemy=Darius]
 * Master+ Solo Queue numbers from the collector, summed over the newest patches.
 *  - champions: every champion's overall games/wins in that role (blind pick, pick rate)
 *  - vsEnemy:   every champion's games/wins against `enemy` in that role
 */
export async function GET(req: NextRequest) {
  const db = getSupabase();
  if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 });

  const sp = req.nextUrl.searchParams;
  const role = sp.get("role") as Role;
  const regionParam = sp.get("region") ?? "all";
  const nPatches = Math.min(10, Math.max(1, Number(sp.get("patches")) || 3));
  const enemy = sp.get("enemy");
  if (!(ROLES as readonly string[]).includes(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }
  if (enemy !== null && !/^[A-Za-z0-9]{1,32}$/.test(enemy)) {
    return NextResponse.json({ error: "Invalid enemy" }, { status: 400 });
  }
  const regions =
    regionParam === "all" ? [...COLLECTOR_REGIONS] : COLLECTOR_REGIONS.filter((r) => r === regionParam);
  if (!regions.length) return NextResponse.json({ error: "Invalid region" }, { status: 400 });

  try {
    const { data: patchRows, error: pe } = await db
      .from("stat_patches")
      .select("patch, region, games")
      .in("region", regions);
    if (pe) throw new Error(pe.message);
    const patches = [...new Set((patchRows ?? []).map((r) => r.patch as string))]
      .sort(comparePatchDesc)
      .slice(0, nPatches);
    const empty: StatsResponse = { patches, champions: [], vsEnemy: null, enemyGames: 0 };
    if (!patches.length) return NextResponse.json(empty);

    const { data: champRows, error: ce } = await db
      .from("champion_stats")
      .select("champion_id, games, wins")
      .eq("role", role)
      .in("region", regions)
      .in("patch", patches);
    if (ce) throw new Error(ce.message);
    const champions = sum(champRows ?? []);

    let vsEnemy: ChampAgg[] | null = null;
    let enemyGames = 0;
    if (enemy) {
      const { data: mRows, error: me } = await db
        .from("matchup_stats")
        .select("champion_id, games, wins, games_short, wins_short, games_long, wins_long")
        .eq("role", role)
        .ilike("opponent_id", enemy)
        .in("region", regions)
        .in("patch", patches);
      if (me) throw new Error(me.message);
      vsEnemy = sum(mRows ?? []);
      enemyGames =
        champions.find((c) => c.championId.toLowerCase() === enemy.toLowerCase())?.games ?? 0;
    }
    let otpVsEnemy: StatsResponse["otpVsEnemy"] = null;
    if (enemy) {
      // One-trick games (table from 005_pro_otp.sql; missing table = no OTP data).
      const { data: oRows, error: oe } = await db
        .from("otp_matchup_stats")
        .select("champion_id, games, wins")
        .eq("role", role)
        .ilike("opponent_id", enemy)
        .in("region", regions)
        .in("patch", patches);
      if (!oe) otpVsEnemy = sum(oRows ?? []).map(({ championId, games, wins }) => ({ championId, games, wins }));
    }
    const body: StatsResponse = { patches, champions, vsEnemy, enemyGames, otpVsEnemy };
    return NextResponse.json(body, { headers: { "cache-control": "s-maxage=300" } });
  } catch (e) {
    console.error("[api/stats]", e);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}

type Row = {
  champion_id: string;
  games: number;
  wins: number;
  games_short?: number;
  wins_short?: number;
  games_long?: number;
  wins_long?: number;
};

function sum(rows: Row[]): ChampAgg[] {
  const m = new Map<string, ChampAgg>();
  for (const r of rows) {
    let a = m.get(r.champion_id);
    if (!a) {
      a = { championId: r.champion_id, games: 0, wins: 0, gamesShort: 0, winsShort: 0, gamesLong: 0, winsLong: 0 };
      m.set(r.champion_id, a);
    }
    a.games += r.games;
    a.wins += r.wins;
    a.gamesShort += r.games_short ?? 0;
    a.winsShort += r.wins_short ?? 0;
    a.gamesLong += r.games_long ?? 0;
    a.winsLong += r.wins_long ?? 0;
  }
  return [...m.values()];
}

function comparePatchDesc(a: string, b: string): number {
  const [a1, a2] = a.split(".").map(Number);
  const [b1, b2] = b.split(".").map(Number);
  return b1 - a1 || b2 - a2;
}
