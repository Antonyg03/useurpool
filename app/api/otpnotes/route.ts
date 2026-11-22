import { NextResponse, type NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabaseServer";
import { ROLES } from "@/lib/types";

export const dynamic = "force-dynamic";
const CHAMP_RE = /^[A-Za-z0-9]{1,32}$/;

function key(o: Record<string, unknown>) {
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
  const v = { role: s("role"), champ: s("champ"), enemy: s("enemy") };
  return (ROLES as readonly string[]).includes(v.role) && CHAMP_RE.test(v.champ) && CHAMP_RE.test(v.enemy) ? v : null;
}

// GET /api/otpnotes?role&champ&enemy  -> statements from one-tricks for this matchup
export async function GET(req: NextRequest) {
  const db = getSupabase();
  if (!db) return NextResponse.json({ notes: [] });
  const v = key(Object.fromEntries(req.nextUrl.searchParams));
  if (!v) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { data, error } = await db
    .from("otp_notes")
    .select("id, text, source, created_at")
    .eq("role", v.role)
    .ilike("champion_id", v.champ)
    .ilike("opponent_id", v.enemy)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ notes: [] });
  return NextResponse.json({ notes: data ?? [] });
}

// POST /api/otpnotes {role, champ, enemy, text, source}
export async function POST(req: NextRequest) {
  const db = getSupabase();
  if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 });
  const b = await req.json().catch(() => null);
  const v = b && key(b);
  const text = String(b?.text ?? "").trim().slice(0, 1500);
  const source = String(b?.source ?? "").trim().slice(0, 200);
  if (!v || !text) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { error } = await db
    .from("otp_notes")
    .insert({ role: v.role, champion_id: v.champ, opponent_id: v.enemy, text, source });
  if (error) {
    console.error("[api/otpnotes]", error.message);
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// DELETE /api/otpnotes?id=...
export async function DELETE(req: NextRequest) {
  const db = getSupabase();
  if (!db) return NextResponse.json({ error: "Database not connected" }, { status: 503 });
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const { error } = await db.from("otp_notes").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Could not delete" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
