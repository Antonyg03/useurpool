"use client";

import type { ChampPatchRow } from "./champTrends";
import type { Role } from "./types";

const cache = new Map<string, Promise<{ patches: string[]; rows: ChampPatchRow[] }>>();

export function fetchChampStats(role: Role, region: string) {
  const key = `${role}|${region}`;
  let p = cache.get(key);
  if (!p) {
    p = fetch(`/api/champstats?${new URLSearchParams({ role, region })}`).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not load stats");
      return j;
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
