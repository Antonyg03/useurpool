// Shared data model. Designed so later phases (Riot API import, pick phase,
// matchup view, Master+ collector) can hang off `Profile` and `PoolEntry`.

export const ROLES = ["top", "jungle", "mid", "bot", "support"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  top: "Top",
  jungle: "Jungle",
  mid: "Mid",
  bot: "Bot",
  support: "Support",
};

/** Comfort tier on the main account. Drives the frame colour of a champion. */
export const TIERS = ["S", "A", "B", "C"] as const;
export type Tier = (typeof TIERS)[number];

/** How much a champion still needs practice (training account). */
export const PRACTICE_NEEDS = ["high", "medium", "some", "almost_done"] as const;
export type PracticeNeed = (typeof PRACTICE_NEEDS)[number];

export const PRACTICE_LABELS: Record<PracticeNeed, string> = {
  high: "High",
  medium: "Medium",
  some: "Some",
  almost_done: "Almost done",
};

export type AccountType = "main" | "training";

export const REGIONS = {
  euw1: "EUW",
  eun1: "EUNE",
  kr: "KR",
  na1: "NA",
  tr1: "TR",
  br1: "BR",
} as const;
export type Region = keyof typeof REGIONS;

export interface PoolEntry {
  role: Role;
  /** Data Dragon champion id, e.g. "Ornn", "MonkeyKing". */
  championId: string;
  tier: Tier;
  /** Only good in specific matchups (explained in `note`). */
  situational: boolean;
  /** Used on training accounts. */
  practiceNeed: PracticeNeed | null;
  note: string;
  sortOrder: number;
}

export interface Profile {
  gameName: string;
  tagLine: string;
  region: Region;
  accountType: AccountType;
  pool: PoolEntry[];
}
