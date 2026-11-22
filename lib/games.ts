import type { Role } from "./types";

/** One compact row per (player, game). Mirrors table `player_games`. */
export interface PlayerGame {
  matchId: string;
  playedAt: string; // ISO
  durationS: number;
  patch: string; // "15.23"
  role: Role | null;
  championId: string;
  opponentChampionId: string | null;
  win: boolean;
  remake: boolean;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  gold: number;
}

const POSITIONS: Record<string, Role> = {
  TOP: "top",
  JUNGLE: "jungle",
  MIDDLE: "mid",
  BOTTOM: "bot",
  UTILITY: "support",
};

export function positionToRole(pos: string | undefined): Role | null {
  return (pos && POSITIONS[pos]) || null;
}

export function patchOf(gameVersion: string): string {
  return gameVersion.split(".").slice(0, 2).join(".");
}

/** match-v5 championName differs from Data Dragon ids in a few cases. */
const FIX_NAMES: Record<string, string> = { FiddleSticks: "Fiddlesticks" };
export function normalizeChampion(name: string): string {
  return FIX_NAMES[name] ?? name;
}
