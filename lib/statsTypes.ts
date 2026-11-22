export interface ChampAgg {
  championId: string;
  games: number;
  wins: number;
  gamesShort: number;
  winsShort: number;
  gamesLong: number;
  winsLong: number;
}

export interface StatsResponse {
  patches: string[];
  /** Overall performance of every champion in the role. */
  champions: ChampAgg[];
  /** Performance of every champion against the requested enemy (null without enemy). */
  vsEnemy: ChampAgg[] | null;
  /** How many games the enemy champion has in this role (for pick share). */
  enemyGames: number;
}
