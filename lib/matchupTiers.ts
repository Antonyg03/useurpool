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

/** Solo Queue column = 80% Master+ and 20% one-tricks (when one-tricks have enough games). */
export const OTP_WEIGHT = 0.2;
export const OTP_MIN_GAMES = 5;

export interface RankedMatchup {
  agg: ChampAgg;
  otp: { games: number; wins: number } | null;
  wr: number; // blended raw win rate
  smoothed: number;
  percentile: number | null; // 0..1, null when not enough games
  tier: MatchupTier;
}

export function minGamesFor(enemyGames: number): number {
  // Below this a matchup gets no tier: too noisy (and filters off-role one-offs).
  return Math.max(15, Math.min(LOW_SAMPLE, Math.round(enemyGames * 0.01)));
}

export function rankMatchups(
  vsEnemy: ChampAgg[],
  enemyGames: number,
  otpRows: { championId: string; games: number; wins: number }[] = [],
): Map<string, RankedMatchup> {
  const min = minGamesFor(enemyGames);
  const otpBy = new Map(otpRows.map((o) => [o.championId.toLowerCase(), o]));
  const blend = (a: ChampAgg) => {
    const o = otpBy.get(a.championId.toLowerCase());
    const m = smoothedWr(a.games, a.wins);
    const raw = a.games ? a.wins / a.games : 0;
    if (!o || o.games < OTP_MIN_GAMES) return { smoothed: m, raw, otp: o ?? null };
    return {
      smoothed: (1 - OTP_WEIGHT) * m + OTP_WEIGHT * smoothedWr(o.games, o.wins),
      raw: (1 - OTP_WEIGHT) * raw + OTP_WEIGHT * (o.wins / o.games),
      otp: o,
    };
  };
  const eligible = vsEnemy.filter((a) => a.games >= min);
  const sorted = eligible.map((a) => blend(a).smoothed).sort((x, y) => x - y);
  const out = new Map<string, RankedMatchup>();
  for (const a of vsEnemy) {
    const b = blend(a);
    const smoothed = b.smoothed;
    let percentile: number | null = null;
    if (a.games >= min && sorted.length >= 5) {
      const below = sorted.filter((v) => v < smoothed).length;
      const equal = sorted.filter((v) => v === smoothed).length;
      percentile = (below + equal / 2) / sorted.length;
    }
    out.set(a.championId.toLowerCase(), {
      agg: a,
      otp: b.otp ? { games: b.otp.games, wins: b.otp.wins } : null,
      wr: b.raw,
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
