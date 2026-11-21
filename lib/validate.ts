import { isRegion, isValidRiotId } from "./riotId";
import { PRACTICE_NEEDS, ROLES, TIERS, type PoolEntry, type Profile } from "./types";

const MAX_ENTRIES = 100;

export function validateProfile(input: unknown): Profile | null {
  if (!input || typeof input !== "object") return null;
  const p = input as Record<string, unknown>;
  const gameName = str(p.gameName);
  const tagLine = str(p.tagLine);
  const region = str(p.region);
  const accountType = p.accountType === "training" ? "training" : "main";
  if (!isValidRiotId(gameName, tagLine) || !isRegion(region)) return null;
  if (!Array.isArray(p.pool) || p.pool.length > MAX_ENTRIES) return null;
  const pool: PoolEntry[] = [];
  const seen = new Set<string>();
  for (const raw of p.pool) {
    const e = validateEntry(raw);
    if (!e) return null;
    const k = `${e.role}:${e.championId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    pool.push(e);
  }
  return { gameName, tagLine, region, accountType, pool };
}

function validateEntry(raw: unknown): PoolEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const role = str(e.role);
  const championId = str(e.championId);
  const tier = str(e.tier);
  const practiceNeed = e.practiceNeed == null ? null : str(e.practiceNeed);
  if (!(ROLES as readonly string[]).includes(role)) return null;
  if (!/^[A-Za-z0-9]{1,32}$/.test(championId)) return null;
  if (!(TIERS as readonly string[]).includes(tier)) return null;
  if (practiceNeed !== null && !(PRACTICE_NEEDS as readonly string[]).includes(practiceNeed)) return null;
  return {
    role: role as PoolEntry["role"],
    championId,
    tier: tier as PoolEntry["tier"],
    situational: e.situational === true,
    practiceNeed: practiceNeed as PoolEntry["practiceNeed"],
    note: str(e.note).slice(0, 1000),
    sortOrder: Number.isFinite(e.sortOrder) ? Math.trunc(e.sortOrder as number) : 0,
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
