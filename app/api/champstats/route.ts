import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabaseServer";
import { ROLES, type Role } from "@/lib/types";

export const dynamic = "force-dynamic";

import type { ChampPatchRow } from "@/lib/champTrends";

/**
 * GET /api/champstats?role=top&region=all
 * Per champion and patch (newest 3 patches) in one role: used for the tier list
 * and patch warnings.
 */
export async function GET(req: NextRequest) {
  const db = getSupabase();
  if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 });
  const sp = req.nextUrl.searchParams;
  const role = sp.get("role") as Role;
  if (!(ROLES as readonly string[]).includes(role)) return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  const r = sp.get("region");
  const regions = r === "euw1" || r === "kr" ? [r] : ["euw1", "kr"];
  try {
    const { data: pr, error: pe } = await db.from("stat_patches").select("patch").in("region", regions);
    if (pe) throw new Error(pe.message);
    const patches = [...new Set((pr ?? []).map((x) => x.patch as string))]
      .sort((a, b) => {
        const [a1, a2] = a.split(".").map(Number);
        const [b1, b2] = b.split(".").map(Number);
        return b1 - a1 || b2 - a2;
      })
      .slice(0, 3);
    if (!patches.length) return NextResponse.json({ patches, rows: [] });
    const { data, error } = await db
      .from("champion_stats")
      .select("champion_id, patch, games, wins")
      .eq("role", role)
      .in("region", regions)
      .in("patch", patches);
    if (error) throw new Error(error.message);
    const m = new Map<string, ChampPatchRow>();
    for (const x of data ?? []) {
      const k = `${x.champion_id}|${x.patch}`;
      const row = m.get(k) ?? { championId: x.champion_id, patch: x.patch, games: 0, wins: 0 };
      row.games += x.games;
      row.wins += x.wins;
      m.set(k, row);
    }
    return NextResponse.json({ patches, rows: [...m.values()] }, { headers: { "cache-control": "s-maxage=600" } });
  } catch (e) {
    console.error("[api/champstats]", e);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}
