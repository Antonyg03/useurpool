import "server-only";
import type { Region } from "./types";

// Thin wrapper around the documented Riot API endpoints we use:
//   account-v1  /riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}
//   match-v5    /lol/match/v5/matches/by-puuid/{puuid}/ids
//   match-v5    /lol/match/v5/matches/{matchId}

const ROUTING: Record<Region, string> = {
  euw1: "europe",
  eun1: "europe",
  tr1: "europe",
  kr: "asia",
  na1: "americas",
  br1: "americas",
};

export const RANKED_SOLO_QUEUE = 420;

export class RiotError extends Error {
  constructor(
    public status: number,
    public retryAfter: number | null,
  ) {
    super(`Riot API ${status}`);
  }
}

export function hasRiotKey(): boolean {
  return Boolean(process.env.RIOT_API_KEY);
}

async function riotGet<T>(region: Region, path: string): Promise<T> {
  const base = process.env.RIOT_API_BASE ?? `https://${ROUTING[region]}.api.riotgames.com`;
  const res = await fetch(base + path, {
    headers: { "X-Riot-Token": process.env.RIOT_API_KEY ?? "" },
    cache: "no-store",
  });
  if (!res.ok) {
    const ra = res.headers.get("retry-after");
    throw new RiotError(res.status, ra ? Number(ra) : null);
  }
  return res.json() as Promise<T>;
}

export async function getPuuid(region: Region, gameName: string, tagLine: string) {
  const acc = await riotGet<{ puuid: string; gameName: string; tagLine: string }>(
    region,
    `/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
  );
  return acc;
}

export function getRankedMatchIds(region: Region, puuid: string, start: number, count = 100) {
  const qs = new URLSearchParams({
    queue: String(RANKED_SOLO_QUEUE),
    start: String(start),
    count: String(count),
  });
  return riotGet<string[]>(region, `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?${qs}`);
}

export interface RiotParticipant {
  puuid: string;
  championName: string;
  teamId: number;
  teamPosition: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  totalMinionsKilled: number;
  neutralMinionsKilled: number;
  goldEarned: number;
}

export interface RiotMatch {
  metadata: { matchId: string };
  info: {
    gameCreation: number;
    gameDuration: number;
    gameVersion: string;
    queueId: number;
    endOfGameResult?: string;
    participants: RiotParticipant[];
  };
}

export function getMatch(region: Region, matchId: string) {
  return riotGet<RiotMatch>(region, `/lol/match/v5/matches/${encodeURIComponent(matchId)}`);
}
