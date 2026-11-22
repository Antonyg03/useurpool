"use client";

import { useEffect, useState } from "react";
import type { Champion } from "@/lib/ddragon";
import { patchWarnings, type PatchWarning } from "@/lib/champTrends";
import { fetchChampStats } from "@/lib/champStatsClient";
import type { Role } from "@/lib/types";

/** Shows win-rate jumps of pool champions between the last two patches (likely buffs/nerfs). */
export function PatchWarnings({
  role,
  champIds,
  lookup,
}: {
  role: Role;
  champIds: string[];
  lookup: (id: string) => Champion | undefined;
}) {
  const [warnings, setWarnings] = useState<PatchWarning[]>([]);
  const key = champIds.join(",");
  useEffect(() => {
    if (!champIds.length) return setWarnings([]);
    let cancelled = false;
    fetchChampStats(role, "all")
      .then(({ patches, rows }) => !cancelled && setWarnings(patchWarnings(patches, rows, champIds)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, key]);

  if (!warnings.length) return null;
  return (
    <div className="notice patch-warn">
      <b>Patch {warnings[0].patch}:</b>{" "}
      {warnings.map((w, i) => (
        <span key={w.championId}>
          {i > 0 && " · "}
          {lookup(w.championId)?.name ?? w.championId}{" "}
          <span className={w.delta > 0 ? "wr-good" : "wr-bad"}>
            {w.delta > 0 ? "+" : "−"}
            {(Math.abs(w.delta) * 100).toFixed(1)}% win rate
          </span>{" "}
          {w.delta > 0 ? "(probably buffed)" : "(probably nerfed)"}
        </span>
      ))}
      <span className="muted"> · compared to {warnings[0].prevPatch}, Master+</span>
    </div>
  );
}
