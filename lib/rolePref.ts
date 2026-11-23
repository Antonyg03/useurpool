"use client";

import { ROLES, type Role } from "./types";

// The last role chosen anywhere on the site, so pool, champ select and tier list
// open on the same lane and stay there after a reload.
const KEY = "uup:role";

export function savedRole(): Role | null {
  try {
    const r = localStorage.getItem(KEY);
    return (ROLES as readonly string[]).includes(r ?? "") ? (r as Role) : null;
  } catch {
    return null;
  }
}

export function saveRole(r: Role) {
  try {
    localStorage.setItem(KEY, r);
  } catch {}
}

/**
 * Saved role if it fits, else the first role that has pool champions, else top.
 * With `onlyPoolRoles`, the saved role is used only if the pool has champions there
 * (champ select shows only those tabs).
 */
export function initialRole(poolRoles: Role[], onlyPoolRoles = false): Role {
  const s = savedRole();
  if (s && (!onlyPoolRoles || !poolRoles.length || poolRoles.includes(s))) return s;
  if (poolRoles.length && !poolRoles.includes("top")) return poolRoles[0];
  return "top";
}
