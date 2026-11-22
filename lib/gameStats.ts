import type { PlayerGame } from "./games";

export interface WinStat {
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
}

export function emptyStat(): WinStat {
  return { games: 0, wins: 0, kills: 0, deaths: 0, assists: 0 };
}

export function add(s: WinStat, g: PlayerGame): void {
  s.games++;
  if (g.win) s.wins++;
  s.kills += g.kills;
  s.deaths += g.deaths;
  s.assists += g.assists;
}

export function winrate(s: WinStat): number {
  return s.games ? s.wins / s.games : 0;
}

export function kda(s: WinStat): string {
  if (!s.games) return "-";
  const v = (s.kills + s.assists) / Math.max(1, s.deaths);
  return v.toFixed(2);
}

export function pct(s: WinStat): string {
  return s.games ? `${Math.round(winrate(s) * 100)}%` : "-";
}

/** Counted games: no remakes. */
export function counted(games: PlayerGame[]): PlayerGame[] {
  return games.filter((g) => !g.remake);
}

export function groupBy(games: PlayerGame[], key: (g: PlayerGame) => string | null) {
  const m = new Map<string, WinStat>();
  for (const g of games) {
    const k = key(g);
    if (!k) continue;
    let s = m.get(k);
    if (!s) m.set(k, (s = emptyStat()));
    add(s, g);
  }
  return m;
}

export function total(games: PlayerGame[]): WinStat {
  const s = emptyStat();
  games.forEach((g) => add(s, g));
  return s;
}

/** Lowercased key so match-v5 names ("FiddleSticks") match Data Dragon ids. */
export function champKey(id: string): string {
  return id.toLowerCase();
}

/**
 * Lane opponents you lose to most: net losses first, then worst winrate.
 * Used for "Lane opponents you lose to most" and the ban suggestion.
 */
export function hardestOpponents(roleGames: PlayerGame[], n = 5, minGames = 2): [string, WinStat][] {
  const byOpp = groupBy(roleGames, (g) => (g.opponentChampionId ? champKey(g.opponentChampionId) : null));
  return [...byOpp.entries()]
    .filter(([, s]) => s.games >= minGames && s.games - s.wins > s.wins)
    .sort((a, b) => {
      const netA = a[1].games - 2 * a[1].wins;
      const netB = b[1].games - 2 * b[1].wins;
      return netB - netA || a[1].wins / a[1].games - b[1].wins / b[1].games;
    })
    .slice(0, n);
}
