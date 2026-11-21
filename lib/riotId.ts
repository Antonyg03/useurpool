import { REGIONS, type Region } from "./types";

export interface RiotId {
  gameName: string;
  tagLine: string;
}

/** Parses "Name#TAG". Returns null when the format is invalid. */
export function parseRiotId(input: string): RiotId | null {
  const idx = input.lastIndexOf("#");
  if (idx < 0) return null;
  const gameName = input.slice(0, idx).trim();
  const tagLine = input.slice(idx + 1).trim();
  if (!isValidRiotId(gameName, tagLine)) return null;
  return { gameName, tagLine };
}

export function isValidRiotId(gameName: string, tagLine: string): boolean {
  return (
    gameName.length >= 3 &&
    gameName.length <= 16 &&
    tagLine.length >= 2 &&
    tagLine.length <= 5 &&
    !tagLine.includes("#") &&
    !tagLine.includes("-")
  );
}

export function isRegion(value: string): value is Region {
  return value in REGIONS;
}

/** URL segment: "Name-TAG" (tags never contain "-"). */
export function toSlug(id: RiotId): string {
  return encodeURIComponent(`${id.gameName}-${id.tagLine}`);
}

export function fromSlug(slug: string): RiotId | null {
  const raw = safeDecode(slug);
  const idx = raw.lastIndexOf("-");
  if (idx < 0) return null;
  const gameName = raw.slice(0, idx);
  const tagLine = raw.slice(idx + 1);
  return isValidRiotId(gameName, tagLine) ? { gameName, tagLine } : null;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Case-insensitive unique key for a Riot account in a region. */
export function riotKey(gameName: string, tagLine: string, region: string): string {
  return `${gameName.trim().toLowerCase()}#${tagLine.trim().toLowerCase()}@${region}`;
}

export function profilePath(region: Region, id: RiotId): string {
  return `/p/${REGIONS[region].toLowerCase()}/${toSlug(id)}`;
}

/** URL uses short region names ("euw"); map back to platform ids. */
export function regionFromUrl(seg: string): Region | null {
  const s = seg.toLowerCase();
  for (const [platform, label] of Object.entries(REGIONS)) {
    if (label.toLowerCase() === s || platform === s) return platform as Region;
  }
  return null;
}
