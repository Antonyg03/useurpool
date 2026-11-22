export interface BuildRow {
  scope: "matchup" | "champion";
  kind: "keystone" | "runes" | "start" | "items" | "skill_start" | "skill_max";
  value: string;
  games: number;
  wins: number;
}

export interface MatchupResponse {
  patches: string[];
  /** Champion vs enemy in the selected region(s). */
  stats: {
    games: number;
    wins: number;
    gamesShort: number;
    winsShort: number;
    gamesLong: number;
    winsLong: number;
  };
  /** Champion overall in the role (all opponents). */
  overall: { games: number; wins: number };
  early: {
    games: number;
    wins: number;
    gold3: number; // average gold difference at 3:00
    xp3: number;
    fbFor: number; // share of games where you got lane first blood before 4:00
    fbAgainst: number;
  } | null;
  builds: BuildRow[];
}
