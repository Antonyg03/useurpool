import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabaseServer";
import { ROLES, type Role } from "@/lib/types";
import { comparePatch, PRO_PATCH_DECAY, type ProResponse, type ProRow } from "@/lib/proStats";

export const dynamic = "force-dynamic";

/**
 * GET /api/pro?role=top&enemy=Darius
 * Pro games (LCK, LPL, LEC, LCS) of every champion against `enemy` in that role,
 * over the newest 10 patches. Newer patches weigh more; data from before a
 * champion's rework (table champion_resets) is ignored.
 */
export async function GET(req: NextRequest) {
  const db = getSupabase();
  if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 });
  const sp = req.nextUrl.searchParams;
  const role = sp.get("role") as Role;
  const enemy = sp.get("enemy") ?? "";
  if (!(ROLES as readonly string[]).includes(role) || !/^[A-Za-z0-9]{1,32}$/.test(enemy)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    const [{ data: rows, error }, { data: resets }, recent] = await Promise.all([
      db.from("pro_games").select("champion_id, patch, win").eq("role", role).ilike("opponent_id", enemy).limit(5000),
      db.from("champion_resets").select("champion_id, since_patch"),
      newestPatches(db, 10),
    ]);
    if (error) throw new Error(error.message);
    const weight = new Map(recent.map((p, i) => [p, Math.pow(PRO_PATCH_DECAY, i)]));
    const resetBy = new Map((resets ?? []).map((r) => [String(r.champion_id).toLowerCase(), String(r.since_patch)]));
    const enemyReset = resetBy.get(enemy.toLowerCase());

    const by = new Map<string, ProRow>();
    let enemyGames = 0;
    for (const r of rows ?? []) {
      const w = weight.get(r.patch);
      if (w === undefined) continue;
      if (enemyReset && comparePatch(r.patch, enemyReset) < 0) continue;
      const myReset = resetBy.get(String(r.champion_id).toLowerCase());
      if (myReset && comparePatch(r.patch, myReset) < 0) continue;
      enemyGames++;
      const x = by.get(r.champion_id) ?? { championId: r.champion_id, games: 0, wins: 0, wGames: 0, wWins: 0 };
      x.games++;
      x.wGames += w;
      if (r.win) {
        x.wins++;
        x.wWins += w;
      }
      by.set(r.champion_id, x);
    }
    const body: ProResponse = { patches: recent, enemyGames, rows: [...by.values()] };
    return NextResponse.json(body, { headers: { "cache-control": "s-maxage=1800" } });
  } catch (e) {
    console.error("[api/pro]", e);
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}

/** Newest distinct patches (Leaguepedia patches are zero-padded, e.g. "26.09", so text order works). */
async function newestPatches(db: NonNullable<ReturnType<typeof getSupabase>>, n: number): Promise<string[]> {
  const out: string[] = [];
  let below: string | null = null;
  for (let i = 0; i < n; i++) {
    let q = db.from("pro_games").select("patch").order("patch", { ascending: false }).limit(1);
    if (below) q = q.lt("patch", below);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const p = data?.[0]?.patch as string | undefined;
    if (!p) break;
    out.push(p);
    below = p;
  }
  return out.sort((a, b) => comparePatch(b, a));
}
