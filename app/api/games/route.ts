import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabaseServer";
import { isRegion, isValidRiotId } from "@/lib/riotId";
import { findPlayer } from "@/lib/playerDb";
import { hasRiotKey } from "@/lib/riotApi";
import type { PlayerGame } from "@/lib/games";

export const dynamic = "force-dynamic";

// GET /api/games?gameName=..&tagLine=..&region=..  -> own ranked games (newest first)
export async function GET(req: NextRequest) {
  const db = getSupabase();
  const riot = hasRiotKey();
  if (!db) return NextResponse.json({ available: false, reason: "database", games: [] });

  const sp = req.nextUrl.searchParams;
  const gameName = sp.get("gameName") ?? "";
  const tagLine = sp.get("tagLine") ?? "";
  const region = sp.get("region") ?? "";
  if (!isValidRiotId(gameName, tagLine) || !isRegion(region)) {
    return NextResponse.json({ error: "Invalid Riot ID" }, { status: 400 });
  }
  try {
    const player = await findPlayer(db, gameName, tagLine, region);
    if (!player?.puuid) {
      return NextResponse.json({ available: riot, reason: riot ? null : "riot", games: [], linked: false });
    }
    const { data, error } = await db
      .from("player_games")
      .select(
        "match_id, played_at, duration_s, patch, role, champion_id, opponent_champion_id, win, remake, kills, deaths, assists, cs, gold",
      )
      .eq("puuid", player.puuid)
      .order("played_at", { ascending: false })
      .limit(3000);
    if (error) throw new Error(error.message);
    const games: PlayerGame[] = (data ?? []).map((r) => ({
      matchId: r.match_id,
      playedAt: r.played_at,
      durationS: r.duration_s,
      patch: r.patch,
      role: r.role,
      championId: r.champion_id,
      opponentChampionId: r.opponent_champion_id,
      win: r.win,
      remake: r.remake,
      kills: r.kills,
      deaths: r.deaths,
      assists: r.assists,
      cs: r.cs,
      gold: r.gold,
    }));
    return NextResponse.json({ available: riot, reason: riot ? null : "riot", games, linked: true });
  } catch (e) {
    console.error("[api/games]", e);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
