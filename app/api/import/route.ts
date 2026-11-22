import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabaseServer";
import { isRegion, isValidRiotId } from "@/lib/riotId";
import { findOrCreatePlayer } from "@/lib/playerDb";
import {
  getMatch,
  getPuuid,
  getRankedMatchIds,
  hasRiotKey,
  RiotError,
  type RiotMatch,
} from "@/lib/riotApi";
import { normalizeChampion, patchOf, positionToRole } from "@/lib/games";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE = 100; // match ids per page (Riot max)
const BATCH = 10; // match details per request, keeps us well inside rate limits

/**
 * POST /api/import
 * body: { gameName, tagLine, region, accountType?, start?: number, mode?: "full" | "new" }
 *
 * Imports one small batch of ranked solo games and tells the client where to
 * continue (`next`). The client calls again until `next` is null.
 * "new" stops as soon as a whole page is already in the database.
 */
export async function POST(req: NextRequest) {
  const db = getSupabase();
  if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 });
  if (!hasRiotKey()) return NextResponse.json({ error: "RIOT_API_KEY is not set" }, { status: 503 });

  const body = await req.json().catch(() => null);
  const gameName = String(body?.gameName ?? "").trim();
  const tagLine = String(body?.tagLine ?? "").trim();
  const region = String(body?.region ?? "");
  const start = Math.max(0, Math.trunc(Number(body?.start) || 0));
  const mode = body?.mode === "new" ? "new" : "full";
  // Match ids that returned 404 earlier in this import run (client sends them back).
  const skip = new Set<string>(
    Array.isArray(body?.skip) ? body.skip.filter((x: unknown) => typeof x === "string").slice(0, 500) : [],
  );
  if (!isValidRiotId(gameName, tagLine) || !isRegion(region)) {
    return NextResponse.json({ error: "Invalid Riot ID" }, { status: 400 });
  }

  try {
    const player = await findOrCreatePlayer(
      db,
      gameName,
      tagLine,
      region,
      body?.accountType === "training" ? "training" : "main",
    );

    let puuid = player.puuid;
    if (!puuid) {
      try {
        puuid = (await getPuuid(region, gameName, tagLine)).puuid;
      } catch (e) {
        if (e instanceof RiotError && e.status === 404) {
          return NextResponse.json(
            { error: `Riot doesn't know "${gameName}#${tagLine}". Check the spelling and tag.` },
            { status: 404 },
          );
        }
        throw e;
      }
      const { error } = await db.from("players").update({ puuid }).eq("id", player.id);
      if (error) throw new Error(error.message);
    }

    const ids = await getRankedMatchIds(region, puuid, start, PAGE);
    let missing = ids;
    if (ids.length) {
      const { data: have, error } = await db
        .from("player_games")
        .select("match_id")
        .eq("puuid", puuid)
        .in("match_id", ids);
      if (error) throw new Error(error.message);
      const haveSet = new Set((have ?? []).map((r) => r.match_id));
      missing = ids.filter((id) => !haveSet.has(id) && !skip.has(id));
    }

    const batch = missing.slice(0, BATCH);
    const matches: RiotMatch[] = [];
    const notFound: string[] = [];
    let rateLimited: number | null = null;
    for (const id of batch) {
      try {
        matches.push(await getMatch(region, id));
      } catch (e) {
        if (e instanceof RiotError && e.status === 429) {
          rateLimited = e.retryAfter ?? 10;
          break;
        }
        if (e instanceof RiotError && e.status === 404) {
          notFound.push(id); // match gone; client will skip it next time
          continue;
        }
        throw e;
      }
    }

    const rows = matches.map((m) => toRow(m, puuid!)).filter((r) => r !== null);
    if (rows.length) {
      const { error } = await db.from("player_games").upsert(rows, { onConflict: "puuid,match_id" });
      if (error) throw new Error(error.message);
    }
    await db.from("players").update({ last_import_at: new Date().toISOString() }).eq("id", player.id);

    // Where to continue.
    const handled = matches.length + notFound.length;
    let next: number | null;
    if (rateLimited !== null || missing.length > handled) next = start; // same page, more to fetch
    else if (mode === "new" && missing.length === 0) next = null; // already up to date
    else if (ids.length === PAGE) next = start + PAGE;
    else next = null;

    return NextResponse.json({ imported: rows.length, next, retryAfter: rateLimited, skipped: notFound });
  } catch (e) {
    if (e instanceof RiotError) {
      if (e.status === 429) return NextResponse.json({ imported: 0, next: start, retryAfter: e.retryAfter ?? 10 });
      const msg =
        e.status === 401 || e.status === 403
          ? "Riot API key is missing, expired or invalid."
          : `Riot API error (${e.status}).`;
      return NextResponse.json({ error: msg }, { status: 502 });
    }
    console.error("[api/import]", e);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}

function toRow(m: RiotMatch, puuid: string) {
  const me = m.info.participants.find((p) => p.puuid === puuid);
  if (!me) return null;
  const opp = me.teamPosition
    ? m.info.participants.find((p) => p.teamId !== me.teamId && p.teamPosition === me.teamPosition)
    : undefined;
  const remake =
    m.info.endOfGameResult === "Abort_Unexpected" || m.info.gameDuration < 300 ? true : false;
  return {
    puuid,
    match_id: m.metadata.matchId,
    played_at: new Date(m.info.gameCreation).toISOString(),
    duration_s: m.info.gameDuration,
    patch: patchOf(m.info.gameVersion),
    role: positionToRole(me.teamPosition),
    champion_id: normalizeChampion(me.championName),
    opponent_champion_id: opp ? normalizeChampion(opp.championName) : null,
    win: me.win,
    remake,
    kills: me.kills,
    deaths: me.deaths,
    assists: me.assists,
    cs: me.totalMinionsKilled + me.neutralMinionsKilled,
    gold: me.goldEarned,
  };
}
