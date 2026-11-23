"use client";

import { useMemo, useState } from "react";
import type { Champion } from "@/lib/ddragon";
import type { PlayerGame } from "@/lib/games";
import { counted, groupBy, hardestOpponents, kda, pct, total, champKey, type WinStat } from "@/lib/gameStats";
import { ROLE_LABELS, type Role } from "@/lib/types";
import { ChampionSearch } from "./ChampionSearch";
import { Portrait } from "./Portrait";

const DAY = 24 * 60 * 60 * 1000;

export function GamesPanel({
  role,
  games,
  champions,
  lookup,
}: {
  role: Role;
  games: PlayerGame[];
  champions: Champion[];
  lookup: (id: string) => Champion | undefined;
}) {
  const [enemy, setEnemy] = useState<Champion | null>(null);

  const roleGames = useMemo(() => counted(games).filter((g) => g.role === role), [games, role]);
  const recent = useMemo(() => {
    const since = Date.now() - 30 * DAY;
    return roleGames.filter((g) => Date.parse(g.playedAt) >= since);
  }, [roleGames]);

  // Season = games on the newest patch "year" (Riot game version 16.x = Season 2026).
  const season = useMemo(() => {
    const major = Math.max(0, ...roleGames.map((g) => Number(g.patch.split(".")[0]) || 0));
    return { major, games: roleGames.filter((g) => (Number(g.patch.split(".")[0]) || 0) === major) };
  }, [roleGames]);
  const [span, setSpan] = useState<"30d" | "season">("30d");
  const shown = span === "30d" ? recent : season.games;
  const seasonLabel = season.major ? `Season ${2010 + season.major}` : "Season";

  const recentTotal = total(recent);
  const seasonTotal = total(season.games);
  const shownTotal = span === "30d" ? recentTotal : seasonTotal;
  const recentByChamp = sortByGames(groupBy(shown, (g) => champKey(g.championId)));

  const hardest = useMemo(() => hardestOpponents(roleGames), [roleGames]);

  const vsEnemy = useMemo(() => {
    if (!enemy) return [];
    const k = champKey(enemy.id);
    return sortByGames(
      groupBy(
        roleGames.filter((g) => g.opponentChampionId && champKey(g.opponentChampionId) === k),
        (g) => champKey(g.championId),
      ),
    );
  }, [enemy, roleGames]);
  const vsEnemyTotal = enemy
    ? total(roleGames.filter((g) => g.opponentChampionId && champKey(g.opponentChampionId) === champKey(enemy.id)))
    : null;

  if (roleGames.length === 0) {
    return (
      <p className="muted small" style={{ marginTop: 0 }}>
        No ranked {ROLE_LABELS[role]} games imported yet.
      </p>
    );
  }

  return (
    <div className="stats-grid">
      <div className="card stat-card">
        <div className="stat-head">
          <div className="segmented segmented-sm">
            <button className={span === "30d" ? "active" : ""} onClick={() => setSpan("30d")}>
              Last 30 days
            </button>
            <button className={span === "season" ? "active" : ""} onClick={() => setSpan("season")}>
              {seasonLabel}
            </button>
          </div>
          <span className="muted small">
            {shownTotal.games} games · <b className={wrClass(shownTotal)}>{pct(shownTotal)}</b>
          </span>
        </div>
        <div className="muted small" style={{ marginBottom: 8 }}>
          Last 30 days: {recentTotal.games} games · {pct(recentTotal)} &nbsp;|&nbsp; {seasonLabel}: {seasonTotal.games}{" "}
          games · {pct(seasonTotal)}
        </div>
        {recentByChamp.length === 0 ? (
          <p className="muted small">
            No {ROLE_LABELS[role]} games {span === "30d" ? "in the last 30 days" : "this season"}.
          </p>
        ) : (
          <StatTable rows={recentByChamp} lookup={lookup} showKda />
        )}
      </div>

      <div className="card stat-card">
        <div className="stat-head">
          <h3>Your matchups</h3>
          <span className="muted small">all imported games</span>
        </div>
        <ChampionSearch
          champions={champions}
          inPool={new Set()}
          onPick={setEnemy}
          placeholder="Enemy laner…"
        />
        {enemy ? (
          <div style={{ marginTop: 12 }}>
            <div className="row" style={{ gap: 8, marginBottom: 8 }}>
              <span className="muted small">vs</span>
              <Portrait champ={enemy} small />
              <b>{enemy.name}</b>
              {vsEnemyTotal && vsEnemyTotal.games > 0 && (
                <span className="muted small">
                  {vsEnemyTotal.games} games · <b className={wrClass(vsEnemyTotal)}>{pct(vsEnemyTotal)}</b>
                </span>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => setEnemy(null)}>
                ✕
              </button>
            </div>
            {vsEnemy.length === 0 ? (
              <p className="muted small">No games against {enemy.name} yet.</p>
            ) : (
              <StatTable rows={vsEnemy} lookup={lookup} />
            )}
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            <div className="muted small" style={{ marginBottom: 6 }}>
              Lane opponents you lose to most
            </div>
            {hardest.length === 0 ? (
              <p className="muted small">Nothing stands out yet.</p>
            ) : (
              <StatTable rows={hardest} lookup={lookup} netLosses />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatTable({
  rows,
  lookup,
  showKda,
  netLosses,
}: {
  rows: [string, WinStat][];
  lookup: (id: string) => Champion | undefined;
  showKda?: boolean;
  netLosses?: boolean;
}) {
  return (
    <table className="stat-table">
      <tbody>
        {rows.map(([id, s]) => {
          const c = lookup(id);
          return (
            <tr key={id}>
              <td>
                <div className="stat-champ">
                  <Portrait champ={c} small />
                  <span>{c?.name ?? id}</span>
                </div>
              </td>
              <td className="num muted">{s.games}</td>
              <td className={`num ${wrClass(s)}`}>{pct(s)}</td>
              {showKda && <td className="num muted">{kda(s)} KDA</td>}
              {netLosses && <td className="num wr-bad">−{s.games - 2 * s.wins}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function sortByGames(m: Map<string, WinStat>): [string, WinStat][] {
  return [...m.entries()].sort((a, b) => b[1].games - a[1].games || b[1].wins - a[1].wins);
}

export function wrClass(s: WinStat): string {
  if (s.games < 3) return "";
  const wr = s.wins / s.games;
  return wr >= 0.55 ? "wr-good" : wr < 0.45 ? "wr-bad" : "";
}
