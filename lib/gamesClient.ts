"use client";

import type { PlayerGame } from "./games";
import type { AccountType, Region } from "./types";

export interface GamesResponse {
  available: boolean;
  reason: "database" | "riot" | null;
  linked?: boolean;
  games: PlayerGame[];
}

export async function fetchGames(gameName: string, tagLine: string, region: Region): Promise<GamesResponse> {
  const qs = new URLSearchParams({ gameName, tagLine, region });
  const res = await fetch(`/api/games?${qs}`, { cache: "no-store" });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Could not load games");
  return json;
}

export interface ImportProgress {
  imported: number;
  waitingS: number | null;
}

/** Runs the batched import until done. Throws with a readable message on errors. */
export async function runImport(
  args: { gameName: string; tagLine: string; region: Region; accountType: AccountType },
  mode: "full" | "new",
  onProgress: (p: ImportProgress) => void,
  signal: { cancelled: boolean },
): Promise<number> {
  let start: number | null = 0;
  let imported = 0;
  const skip: string[] = [];
  while (start !== null && !signal.cancelled) {
    const res: Response = await fetch("/api/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...args, start, mode, skip }),
    });
    const json: { error?: string; imported?: number; skipped?: string[]; retryAfter?: number | null; next: number | null } =
      await res.json().catch(() => ({ error: "Import failed", next: null }));
    if (!res.ok) throw new Error(json.error ?? "Import failed");
    imported += json.imported ?? 0;
    skip.push(...(json.skipped ?? []));
    if (json.retryAfter) {
      for (let s = Math.ceil(json.retryAfter); s > 0 && !signal.cancelled; s--) {
        onProgress({ imported, waitingS: s });
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    onProgress({ imported, waitingS: null });
    start = json.next;
  }
  return imported;
}
