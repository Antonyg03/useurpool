"use client";

import { useEffect, useState } from "react";
import type { Champion } from "@/lib/ddragon";
import { champKey } from "@/lib/gameStats";
import type { ProResponse } from "@/lib/proStats";
import type { Role } from "@/lib/types";
import { Portrait } from "./Portrait";

export function ProColumn({
  role,
  enemy,
  lookup,
  poolIds,
  onOpen,
}: {
  role: Role;
  enemy: Champion;
  lookup: (id: string) => Champion | undefined;
  poolIds: Set<string>;
  onOpen: (championId: string) => void;
}) {
  const [data, setData] = useState<ProResponse | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError("");
    fetch(`/api/pro?${new URLSearchParams({ role, enemy: enemy.id })}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Could not load pro games");
        if (!cancelled) setData(j);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [role, enemy.id]);

  const rows = (data?.rows ?? []).sort((a, b) => b.games - a.games || b.wWins / b.wGames - a.wWins / a.wGames);
  return (
    <div className="card stat-card">
      <div className="stat-head">
        <h3>Pro Play</h3>
        <span className="muted small">{data ? `${data.enemyGames} games` : ""}</span>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        LCK, LPL, LEC, LCS · last {data?.patches.length || 10} patches, newer ones count more
      </p>
      {error && <p className="error">{error}</p>}
      {!data && !error ? (
        <p className="muted small">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="muted small">{enemy.name} wasn&apos;t played in this role in pro games recently.</p>
      ) : (
        <table className="stat-table">
          <thead>
            <tr className="muted small">
              <td></td>
              <td className="num">Pick</td>
              <td className="num">Win</td>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 15).map((r) => {
              const c = lookup(r.championId);
              const wr = r.wWins / r.wGames;
              return (
                <tr
                  key={r.championId}
                  className={`click-row ${poolIds.has(champKey(r.championId)) ? "in-pool-row" : ""}`}
                  onClick={() => onOpen(c?.id ?? r.championId)}
                >
                  <td>
                    <div className="stat-champ">
                      <Portrait champ={c} small />
                      <span className="small">{c?.name ?? r.championId}</span>
                    </div>
                  </td>
                  <td className="num muted small">{r.games}</td>
                  <td className={`num small ${r.games >= 5 ? (wr >= 0.55 ? "wr-good" : wr < 0.45 ? "wr-bad" : "") : "muted"}`}>
                    {Math.round(wr * 100)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="muted small" style={{ marginBottom: 0 }}>Pro samples are small: read them as “what pros trust”, not as proof.</p>
    </div>
  );
}
