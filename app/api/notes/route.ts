import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabaseServer";
import { isRegion, isValidRiotId } from "@/lib/riotId";
import { findOrCreatePlayer, findPlayer } from "@/lib/playerDb";
import { ROLES } from "@/lib/types";

export const dynamic = "force-dynamic";
const CHAMP_RE = /^[A-Za-z0-9]{1,32}$/;

function parse(o: Record<string, unknown>) {
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
  const v = {
    gameName: s("gameName"),
    tagLine: s("tagLine"),
    region: s("region"),
    role: s("role"),
    champ: s("champ"),
    enemy: s("enemy"),
  };
  const ok =
    isValidRiotId(v.gameName, v.tagLine) &&
    isRegion(v.region) &&
    (ROLES as readonly string[]).includes(v.role) &&
    CHAMP_RE.test(v.champ) &&
    CHAMP_RE.test(v.enemy);
  return ok ? v : null;
}

// GET /api/notes?gameName&tagLine&region&role&champ&enemy
export async function GET(req: NextRequest) {
  const db = getSupabase();
  if (!db) return NextResponse.json({ configured: false, note: "" });
  const v = parse(Object.fromEntries(req.nextUrl.searchParams));
  if (!v) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const player = await findPlayer(db, v.gameName, v.tagLine, v.region as never);
    if (!player) return NextResponse.json({ configured: true, note: "" });
    const { data, error } = await db
      .from("matchup_notes")
      .select("note")
      .eq("player_id", player.id)
      .eq("role", v.role)
      .eq("champion_id", v.champ)
      .eq("opponent_id", v.enemy)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return NextResponse.json({ configured: true, note: data?.note ?? "" });
  } catch (e) {
    console.error("[api/notes]", e);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}

// PUT /api/notes  body: {...same, note}
export async function PUT(req: NextRequest) {
  const db = getSupabase();
  if (!db) return NextResponse.json({ configured: false });
  const body = await req.json().catch(() => null);
  const v = body && parse(body);
  if (!v) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const note = String(body.note ?? "").slice(0, 4000);
  try {
    const player = await findOrCreatePlayer(db, v.gameName, v.tagLine, v.region as never, "main");
    const { error } = await db.from("matchup_notes").upsert(
      {
        player_id: player.id,
        role: v.role,
        champion_id: v.champ,
        opponent_id: v.enemy,
        note,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "player_id,role,champion_id,opponent_id" },
    );
    if (error) throw new Error(error.message);
    return NextResponse.json({ configured: true, ok: true });
  } catch (e) {
    console.error("[api/notes]", e);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
