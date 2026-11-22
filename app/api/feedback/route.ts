import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabaseServer";
import { isRegion, isValidRiotId } from "@/lib/riotId";
import { findPlayer } from "@/lib/playerDb";

export const dynamic = "force-dynamic";
const CHAMP_RE = /^[A-Za-z0-9]{1,32}$/;

// POST /api/feedback  {gameName, tagLine, region, role, champ, enemy, helpful, comment}
export async function POST(req: NextRequest) {
  const db = getSupabase();
  if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 });
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  try {
    let playerId: string | null = null;
    if (isValidRiotId(str(b.gameName), str(b.tagLine)) && isRegion(str(b.region))) {
      playerId = (await findPlayer(db, str(b.gameName), str(b.tagLine), str(b.region) as never))?.id ?? null;
    }
    const { error } = await db.from("feedback").insert({
      player_id: playerId,
      role: str(b.role).slice(0, 10) || null,
      champion_id: CHAMP_RE.test(str(b.champ)) ? str(b.champ) : null,
      opponent_id: CHAMP_RE.test(str(b.enemy)) ? str(b.enemy) : null,
      helpful: typeof b.helpful === "boolean" ? b.helpful : null,
      comment: str(b.comment).slice(0, 2000),
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/feedback]", e);
    return NextResponse.json({ error: "Could not save feedback" }, { status: 500 });
  }
}
