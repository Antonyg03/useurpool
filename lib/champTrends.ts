import { smoothedWr } from "./matchupTiers";

export interface ChampPatchRow {
  championId: string;
  patch: string;
  games: number;
  wins: number;
}

export interface PatchWarning {
  championId: string;
  patch: string;
  prevPatch: string;
  delta: number; // win rate change, e.g. -0.021
  games: number;
}

/** Win rate change from the previous to the newest patch (needs enough games on both). */
export function patchWarnings(patches: string[], rows: ChampPatchRow[], champs: string[], minGames = 200, minDelta = 0.015): PatchWarning[] {
  if (patches.length < 2) return [];
  const [now, prev] = patches;
  const out: PatchWarning[] = [];
  for (const c of champs) {
    const a = rows.find((r) => r.championId.toLowerCase() === c.toLowerCase() && r.patch === now);
    const b = rows.find((r) => r.championId.toLowerCase() === c.toLowerCase() && r.patch === prev);
    if (!a || !b || a.games < minGames || b.games < minGames) continue;
    const delta = a.wins / a.games - b.wins / b.games;
    if (Math.abs(delta) >= minDelta) out.push({ championId: c, patch: now, prevPatch: prev, delta, games: a.games });
  }
  return out.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}

export type AutoTier = "S" | "A" | "B" | "C" | "D";

export interface TierEntry {
  championId: string;
  games: number;
  wins: number;
  wr: number;
  pickRate: number;
  score: number;
  tier: AutoTier;
}

/**
 * Auto tier list over all given patches: smoothed win rate, small bonus for
 * pick rate, ranked by percentile. Champions below 0.5% pick rate are left out.
 */
export function autoTiers(rows: ChampPatchRow[]): TierEntry[] {
  const by = new Map<string, { games: number; wins: number }>();
  for (const r of rows) {
    const s = by.get(r.championId) ?? { games: 0, wins: 0 };
    s.games += r.games;
    s.wins += r.wins;
    by.set(r.championId, s);
  }
  const totalChampGames = [...by.values()].reduce((s, x) => s + x.games, 0);
  const matches = totalChampGames / 2; // two champions per role per game
  const list = [...by.entries()]
    .map(([championId, s]) => {
      const pickRate = matches ? s.games / matches : 0;
      const sw = smoothedWr(s.games, s.wins);
      return { championId, games: s.games, wins: s.wins, wr: s.wins / s.games, pickRate, score: sw + Math.min(pickRate, 0.15) * 0.1 };
    })
    .filter((x) => x.pickRate >= 0.005 && x.games >= 30)
    .sort((a, b) => b.score - a.score);
  const n = list.length;
  return list.map((x, i) => {
    const p = n > 1 ? i / (n - 1) : 0; // 0 = best
    const tier: AutoTier = p < 0.1 ? "S" : p < 0.3 ? "A" : p < 0.7 ? "B" : p < 0.9 ? "C" : "D";
    return { ...x, tier };
  });
}
