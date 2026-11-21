import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabaseServer";
import { isRegion, isValidRiotId, riotKey } from "@/lib/riotId";
import { validateProfile } from "@/lib/validate";
import type { PoolEntry, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

// GET /api/profile?gameName=..&tagLine=..&region=euw1
export async function GET(req: NextRequest) {
  const db = getSupabase();
  if (!db) return NextResponse.json({ configured: false });

  const sp = req.nextUrl.searchParams;
  const gameName = sp.get("gameName") ?? "";
  const tagLine = sp.get("tagLine") ?? "";
  const region = sp.get("region") ?? "";
  if (!isValidRiotId(gameName, tagLine) || !isRegion(region)) {
    return NextResponse.json({ error: "Invalid Riot ID" }, { status: 400 });
  }

  const { data: player, error } = await db
    .from("players")
    .select("id, game_name, tag_line, region, account_type")
    .eq("riot_key", riotKey(gameName, tagLine, region))
    .maybeSingle();
  if (error) return dbError(error);
  if (!player) return NextResponse.json({ configured: true, profile: null });

  const { data: rows, error: e2 } = await db
    .from("pool_entries")
    .select("role, champion_id, comfort_tier, situational, practice_need, note, sort_order")
    .eq("player_id", player.id)
    .order("sort_order");
  if (e2) return dbError(e2);

  const profile: Profile = {
    gameName: player.game_name,
    tagLine: player.tag_line,
    region: player.region,
    accountType: player.account_type,
    pool: (rows ?? []).map(
      (r): PoolEntry => ({
        role: r.role,
        championId: r.champion_id,
        tier: r.comfort_tier,
        situational: r.situational,
        practiceNeed: r.practice_need,
        note: r.note ?? "",
        sortOrder: r.sort_order,
      }),
    ),
  };
  return NextResponse.json({ configured: true, profile });
}

// PUT /api/profile  body: Profile  (replaces the whole pool)
export async function PUT(req: NextRequest) {
  const db = getSupabase();
  if (!db) return NextResponse.json({ configured: false });

  const profile = validateProfile(await req.json().catch(() => null));
  if (!profile) return NextResponse.json({ error: "Invalid profile" }, { status: 400 });

  const { data: player, error } = await db
    .from("players")
    .upsert(
      {
        riot_key: riotKey(profile.gameName, profile.tagLine, profile.region),
        game_name: profile.gameName,
        tag_line: profile.tagLine,
        region: profile.region,
        account_type: profile.accountType,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "riot_key" },
    )
    .select("id")
    .single();
  if (error) return dbError(error);

  const { error: delErr } = await db.from("pool_entries").delete().eq("player_id", player.id);
  if (delErr) return dbError(delErr);

  if (profile.pool.length) {
    const { error: insErr } = await db.from("pool_entries").insert(
      profile.pool.map((e) => ({
        player_id: player.id,
        role: e.role,
        champion_id: e.championId,
        comfort_tier: e.tier,
        situational: e.situational,
        practice_need: e.practiceNeed,
        note: e.note,
        sort_order: e.sortOrder,
      })),
    );
    if (insErr) return dbError(insErr);
  }
  return NextResponse.json({ configured: true, ok: true });
}

function dbError(error: { message: string }) {
  console.error("[api/profile]", error.message);
  return NextResponse.json({ error: "Database error" }, { status: 500 });
}
