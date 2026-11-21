"use client";

// Loads/saves profiles. Uses Supabase via /api/profile when the server has
// keys configured; otherwise falls back to this browser's localStorage so the
// site is usable right after the first deploy.

import { riotKey } from "./riotId";
import type { Profile, Region } from "./types";

export type StorageMode = "cloud" | "local";

const LOCAL_PREFIX = "uup:profile:";
const RECENT_KEY = "uup:recent";

export async function loadProfile(
  gameName: string,
  tagLine: string,
  region: Region,
): Promise<{ profile: Profile | null; mode: StorageMode }> {
  try {
    const qs = new URLSearchParams({ gameName, tagLine, region });
    const res = await fetch(`/api/profile?${qs}`, { cache: "no-store" });
    const json = await res.json();
    if (json.configured) {
      if (!res.ok) throw new Error(json.error ?? "Load failed");
      return { profile: json.profile, mode: "cloud" };
    }
  } catch (err) {
    console.warn("Cloud load failed, using local storage", err);
  }
  return { profile: readLocal(riotKey(gameName, tagLine, region)), mode: "local" };
}

/** Synchronous local backup; call on every change so nothing is lost. */
export function saveLocal(profile: Profile): void {
  writeLocal(profile);
}

export async function saveProfile(profile: Profile, mode: StorageMode): Promise<void> {
  writeLocal(profile);
  if (mode !== "cloud") return;
  const res = await fetch("/api/profile", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(profile),
    keepalive: true,
  });
  if (!res.ok) throw new Error("Save failed");
}

function readLocal(key: string): Profile | null {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PREFIX + key) ?? "null");
  } catch {
    return null;
  }
}

function writeLocal(p: Profile) {
  try {
    localStorage.setItem(
      LOCAL_PREFIX + riotKey(p.gameName, p.tagLine, p.region),
      JSON.stringify(p),
    );
  } catch {
    /* ignore */
  }
}

export interface RecentAccount {
  gameName: string;
  tagLine: string;
  region: Region;
  accountType: Profile["accountType"];
}

export function getRecent(): RecentAccount[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function rememberRecent(a: RecentAccount) {
  const key = riotKey(a.gameName, a.tagLine, a.region);
  const list = getRecent().filter((r) => riotKey(r.gameName, r.tagLine, r.region) !== key);
  list.unshift(a);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6)));
  } catch {
    /* ignore */
  }
}
