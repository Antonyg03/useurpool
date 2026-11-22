import type { ChampAgg } from "./statsTypes";

// Matchup tiers are RELATIVE: for one enemy we rank every champion that has
// enough games against it and look at the percentile, instead of fixed winrate
// cut-offs. Winrates are smoothed towards 50% so tiny samples don't dominate.

export type MatchupTier = "great" | "good" | "even" | "hard" | "avoid" | "unknown";

export const MATCHUP_TIER_LABELS: Record<MatchupTier, string> = {
  great: "Great",
  good: "Good",
  even: "Even",
  hard: "Hard",
  avoid: "Avoid",
  unknown: "Few games",
};

export const MATCHUP_TIER_ORDER: MatchupTier[] = ["great", "good", "even", "hard", "avoid", "unknown"];

/** Below this many games we warn that the number is shaky. */
export const LOW_SAMPLE = 30;
const PRIOR = 20; // pseudo-games at 50% for smoothing

export function smoothedWr(games: number, wins: number): number {
  return (wins + PRIOR * 0.5) / (games + PRIOR);
}

export interface RankedMatchup {
  agg: ChampAgg;
  wr: number; // raw
  smoothed: number;
  percentile: number | null; // 0..1, null when not enough games
  tier: MatchupTier;
}

export function minGamesFor(enemyGames: number): number {
  // Below this a matchup gets no tier: too noisy (and filters off-role one-offs).
  return Math.max(15, Math.min(LOW_SAMPLE, Math.round(enemyGames * 0.01)));
}

export function rankMatchups(vsEnemy: ChampAgg[], enemyGames: number): Map<string, RankedMatchup> {
  const min = minGamesFor(enemyGames);
  const eligible = vsEnemy.filter((a) => a.games >= min);
  const sorted = eligible.map((a) => smoothedWr(a.games, a.wins)).sort((x, y) => x - y);
  const out = new Map<string, RankedMatchup>();
  for (const a of vsEnemy) {
    const smoothed = smoothedWr(a.games, a.wins);
    let percentile: number | null = null;
    if (a.games >= min && sorted.length >= 5) {
      const below = sorted.filter((v) => v < smoothed).length;
      const equal = sorted.filter((v) => v === smoothed).length;
      percentile = (below + equal / 2) / sorted.length;
    }
    out.set(a.championId.toLowerCase(), {
      agg: a,
      wr: a.games ? a.wins / a.games : 0,
      smoothed,
      percentile,
      tier: tierOf(percentile),
    });
  }
  return out;
}

export function tierOf(p: number | null): MatchupTier {
  if (p === null) return "unknown";
  if (p >= 0.8) return "great";
  if (p >= 0.6) return "good";
  if (p >= 0.4) return "even";
  if (p >= 0.2) return "hard";
  return "avoid";
}
