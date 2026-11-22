export interface ProRow {
  championId: string;
  games: number;
  wins: number;
  /** Weighted by patch age (newer patches count more). */
  wGames: number;
  wWins: number;
}

export interface ProResponse {
  patches: string[]; // newest first, max 10
  enemyGames: number;
  rows: ProRow[];
}

/** Each older patch counts this much less than the one after it. */
export const PRO_PATCH_DECAY = 0.85;

export function comparePatch(a: string, b: string): number {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}
