"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { loadChampions, searchChampions, type Champion } from "@/lib/ddragon";
import { fromSlug, profilePath, regionFromUrl } from "@/lib/riotId";
import { loadProfile } from "@/lib/store";
import { fetchGames } from "@/lib/gamesClient";
import type { PlayerGame } from "@/lib/games";
import { champKey, counted, groupBy, hardestOpponents, pct, total, type WinStat } from "@/lib/gameStats";
import type { StatsResponse } from "@/lib/statsTypes";
import {
  LOW_SAMPLE,
  MATCHUP_TIER_LABELS,
  MATCHUP_TIER_ORDER,
  minGamesFor,
  rankMatchups,
  smoothedWr,
  type RankedMatchup,
} from "@/lib/matchupTiers";
import {
  PRACTICE_LABELS,
  PRACTICE_NEEDS,
  ROLES,
  ROLE_LABELS,
  TIERS,
  type PoolEntry,
  type Profile,
  type Role,
} from "@/lib/types";
import { ChampionSearch } from "./ChampionSearch";
import { Portrait } from "./Portrait";
import { wrClass } from "./GamesPanel";

type StatRegion = "euw1" | "kr" | "all";
type Mode = "blind" | "last";
const DAY = 86400_000;

export function PickView() {
  const params = useParams<{ region: string; riotId: string }>();
  const region = regionFromUrl(params.region);
  const id = fromSlug(params.riotId);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [games, setGames] = useState<PlayerGame[]>([]);
  const [champions, setChampions] = useState<Champion[]>([]);
  const [role, setRole] = useState<Role>("top");
  const [mode, setMode] = useState<Mode>("last");
  const [statRegion, setStatRegion] = useState<StatRegion>("all");
  const [enemy, setEnemy] = useState<Champion | null>(null);
  const [blindPick, setBlindPick] = useState<string | null>(null);
  const [overall, setOverall] = useState<StatsResponse | null>(null);
  const [vs, setVs] = useState<StatsResponse | null>(null);
  const [statsError, setStatsError] = useState("");

  useEffect(() => {
    loadChampions().then(setChampions).catch(() => {});
    try {
      const r = localStorage.getItem("uup:statRegion");
      if (r === "euw1" || r === "kr" || r === "all") setStatRegion(r);
    } catch {}
  }, []);

  useEffect(() => {
    if (!region || !id) return;
    loadProfile(id.gameName, id.tagLine, region).then(({ profile: p }) => {
      if (!p) return setProfile({ gameName: id.gameName, tagLine: id.tagLine, region, accountType: "main", pool: [] });
      setProfile(p);
      const roles = ROLES.filter((r) => p.pool.some((e) => e.role === r));
      if (roles.length && !roles.includes("top")) setRole(roles[0]);
    });
    fetchGames(id.gameName, id.tagLine, region)
      .then((g) => setGames(g.games))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.region, params.riotId]);

  const getStats = useCallback(
    async (enemyId: string | null): Promise<StatsResponse> => {
      const qs = new URLSearchParams({ role, region: statRegion, patches: "3" });
      if (enemyId) qs.set("enemy", enemyId);
      const res = await fetch(`/api/stats?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not load stats");
      return json;
    },
    [role, statRegion],
  );

  useEffect(() => {
    setStatsError("");
    getStats(null)
      .then(setOverall)
      .catch((e) => setStatsError(e.message));
  }, [getStats]);

  useEffect(() => {
    if (!enemy) return setVs(null);
    let cancelled = false;
    setVs(null);
    getStats(enemy.id)
      .then((s) => !cancelled && setVs(s))
      .catch((e) => !cancelled && setStatsError(e.message));
    return () => {
      cancelled = true;
    };
  }, [enemy, getStats]);

  const champByKey = useMemo(() => new Map(champions.map((c) => [champKey(c.id), c])), [champions]);
  const lookup = useCallback((cid: string) => champByKey.get(champKey(cid)), [champByKey]);

  const roleGames = useMemo(() => counted(games).filter((g) => g.role === role), [games, role]);
  const ownByChamp = useMemo(() => groupBy(roleGames, (g) => champKey(g.championId)), [roleGames]);
  const pool = useMemo(
    () => (profile?.pool ?? []).filter((e) => e.role === role).sort((a, b) => a.sortOrder - b.sortOrder),
    [profile, role],
  );

  if (!region || !id) return <p className="error">That Riot ID doesn&apos;t look right.</p>;
  if (!profile) return <p className="muted">Loading…</p>;

  const isTraining = profile.accountType === "training";
  const rolesWithPool = ROLES.filter((r) => profile.pool.some((e) => e.role === r));
  const tabs = rolesWithPool.length ? rolesWithPool : ROLES;

  function changeRegion(r: StatRegion) {
    setStatRegion(r);
    try {
      localStorage.setItem("uup:statRegion", r);
    } catch {}
  }

  return (
    <div>
      <div className="profile-head">
        <div>
          <Link href={profilePath(region, id)} className="muted small" style={{ textDecoration: "none" }}>
            ← {profile.gameName}#{profile.tagLine} · pool
          </Link>
          <h1 style={{ marginTop: 6 }}>Champ select</h1>
          <p className="muted small" style={{ margin: 0 }}>
            {isTraining ? "Training account" : "Main account"} · Master+ Solo Queue
            {overall?.patches.length ? ` · patches ${overall.patches.join(", ")}` : ""}
          </p>
        </div>
        <div className="segmented" aria-label="Stats region">
          {(["euw1", "kr", "all"] as StatRegion[]).map((r) => (
            <button key={r} className={statRegion === r ? "active" : ""} onClick={() => changeRegion(r)}>
              {r === "euw1" ? "EUW" : r === "kr" ? "KR" : "EUW + KR"}
            </button>
          ))}
        </div>
      </div>

      <div className="tabs">
        {tabs.map((r) => (
          <button
            key={r}
            className={role === r ? "active" : ""}
            onClick={() => {
              setRole(r);
              setEnemy(null);
              setBlindPick(null);
            }}
          >
            {ROLE_LABELS[r]}
          </button>
        ))}
      </div>

      {statsError && <div className="notice error">{statsError}</div>}
      {overall && overall.patches.length === 0 && (
        <div className="notice">
          The Master+ collector hasn&apos;t gathered any games yet. Solo Queue numbers will appear once it has
          run for a while. Your own stats work already.
        </div>
      )}

      <QueueUp roleGames={roleGames} pool={pool} lookup={lookup} ownByChamp={ownByChamp} overall={overall} />

      <div className="row" style={{ margin: "22px 0 16px" }}>
        <div className="segmented">
          <button className={mode === "blind" ? "active" : ""} onClick={() => setMode("blind")}>
            Blind pick
          </button>
          <button className={mode === "last" ? "active" : ""} onClick={() => setMode("last")}>
            Last pick
          </button>
        </div>
        {mode === "last" && (
          <div className="grow" style={{ maxWidth: 380 }}>
            <ChampionSearch
              champions={champions}
              inPool={new Set()}
              onPick={setEnemy}
              placeholder="Enemy laner…"
            />
          </div>
        )}
        {mode === "last" && enemy && (
          <div className="row" style={{ gap: 8 }}>
            <span className="muted small">vs</span>
            <Portrait champ={enemy} small />
            <b>{enemy.name}</b>
            <button className="btn btn-ghost btn-sm" onClick={() => setEnemy(null)}>
              ✕
            </button>
          </div>
        )}
      </div>

      {pool.length === 0 ? (
        <p className="muted">
          No {ROLE_LABELS[role]} champions in your pool yet.{" "}
          <Link href={profilePath(region, id)}>Add some</Link>.
        </p>
      ) : mode === "blind" ? (
        <BlindPick
          pool={pool}
          lookup={lookup}
          ownByChamp={ownByChamp}
          overall={overall}
          selected={blindPick}
          onSelect={setBlindPick}
        />
      ) : enemy ? (
        <LastPick
          base={profilePath(region, id)}
          enemy={enemy}
          pool={pool}
          isTraining={isTraining}
          lookup={lookup}
          champions={champions}
          roleGames={roleGames}
          vs={vs}
        />
      ) : (
        <p className="muted">Type the enemy laner above to see your best pick.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function QueueUp({
  roleGames,
  pool,
  lookup,
  ownByChamp,
  overall,
}: {
  roleGames: PlayerGame[];
  pool: PoolEntry[];
  lookup: (id: string) => Champion | undefined;
  ownByChamp: Map<string, WinStat>;
  overall: StatsResponse | null;
}) {
  const bans = hardestOpponents(roleGames, 3);
  const recent = roleGames.filter((g) => Date.parse(g.playedAt) >= Date.now() - 30 * DAY);
  const recentTotal = total(recent);
  const recentBy = groupBy(recent, (g) => champKey(g.championId));
  const roleTotal = overall?.champions.reduce((s, c) => s + c.games, 0) ?? 0;

  return (
    <div className="stats-grid">
      <div className="card stat-card">
        <div className="stat-head">
          <h3>Ban suggestion</h3>
          <span className="muted small">from your own games</span>
        </div>
        {bans.length === 0 ? (
          <p className="muted small">No lane opponent stands out yet. Import more games on your pool page.</p>
        ) : (
          <table className="stat-table">
            <tbody>
              {bans.map(([cid, s], i) => {
                const c = lookup(cid);
                return (
                  <tr key={cid}>
                    <td>
                      <div className="stat-champ">
                        <Portrait champ={c} small />
                        <span>
                          {i === 0 && <b>Ban </b>}
                          {c?.name ?? cid}
                        </span>
                      </div>
                    </td>
                    <td className="num muted">{s.games} games</td>
                    <td className={`num ${wrClass(s)}`}>{pct(s)}</td>
                    <td className="num wr-bad">−{s.games - 2 * s.wins}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="card stat-card">
        <div className="stat-head">
          <h3>Your pool</h3>
          <span className="muted small">
            last 30 days: {recentTotal.games} games · <b className={wrClass(recentTotal)}>{pct(recentTotal)}</b>
          </span>
        </div>
        <table className="stat-table">
          <tbody>
            {pool.map((e) => {
              const c = lookup(e.championId);
              const r = recentBy.get(champKey(e.championId));
              const all = ownByChamp.get(champKey(e.championId));
              const m = overall?.champions.find((x) => champKey(x.championId) === champKey(e.championId));
              return (
                <tr key={e.championId}>
                  <td>
                    <div className="stat-champ">
                      <Portrait champ={c} tier={e.tier} small />
                      <span>{c?.name ?? e.championId}</span>
                    </div>
                  </td>
                  <td className="num muted" title="Your games in the last 30 days">
                    {r?.games ?? 0} · <span className={r ? wrClass(r) : ""}>{r ? pct(r) : "-"}</span>
                  </td>
                  <td className="num muted small" title="Your winrate, all imported games">
                    all: {all ? `${pct(all)} (${all.games})` : "-"}
                  </td>
                  <td className="num muted small" title="Master+ winrate · pick rate in this role">
                    {m && roleTotal ? `M+ ${pctNum(m.wins / m.games)} · ${pctNum((2 * m.games) / roleTotal, 1)} pick` : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function BlindPick({
  pool,
  lookup,
  ownByChamp,
  overall,
  selected,
  onSelect,
}: {
  pool: PoolEntry[];
  lookup: (id: string) => Champion | undefined;
  ownByChamp: Map<string, WinStat>;
  overall: StatsResponse | null;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const sorted = [...pool].sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier));
  const sel = pool.find((e) => e.championId === selected);
  return (
    <div>
      <div className="grid">
        {sorted.map((e) => {
          const c = lookup(e.championId);
          const own = ownByChamp.get(champKey(e.championId));
          const m = overall?.champions.find((x) => champKey(x.championId) === champKey(e.championId));
          return (
            <button
              key={e.championId}
              className={`champ pick-card ${selected === e.championId ? "selected" : ""}`}
              onClick={() => onSelect(e.championId)}
            >
              <div className="champ-top">
                <Portrait champ={c} tier={e.tier} />
                <div className="grow" style={{ textAlign: "left" }}>
                  <div className="champ-name">{c?.name ?? e.championId}</div>
                  <div className="muted small">
                    {m ? `Master+ ${pctNum(m.wins / m.games)} (${m.games})` : "No Master+ data"}
                  </div>
                  <div className="muted small">
                    You: {own ? `${pct(own)} (${own.games})` : "no games"}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {sel && (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Why {lookup(sel.championId)?.name ?? sel.championId}?</h3>
          {sel.note ? (
            <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{sel.note}</p>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>
              No note yet. Add one on your pool page (Note button on the champion).
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function LastPick({
  base,
  enemy,
  pool,
  isTraining,
  lookup,
  champions,
  roleGames,
  vs,
}: {
  base: string;
  enemy: Champion;
  pool: PoolEntry[];
  isTraining: boolean;
  lookup: (id: string) => Champion | undefined;
  champions: Champion[];
  roleGames: PlayerGame[];
  vs: StatsResponse | null;
}) {
  const [filter, setFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [showRare, setShowRare] = useState(false);
  const ranked = useMemo(() => rankMatchups(vs?.vsEnemy ?? [], vs?.enemyGames ?? 0), [vs]);

  const vsGames = roleGames.filter(
    (g) => g.opponentChampionId && champKey(g.opponentChampionId) === champKey(enemy.id),
  );
  const ownVs = groupBy(vsGames, (g) => champKey(g.championId));
  const ownTop3 = [...ownVs.entries()]
    .sort((a, b) => smoothedWr(b[1].games, b[1].wins) - smoothedWr(a[1].games, a[1].wins) || b[1].games - a[1].games)
    .slice(0, 3);

  const rows = pool.map((e) => ({ e, m: ranked.get(champKey(e.championId)) }));
  const tierIdx = (m?: RankedMatchup) => MATCHUP_TIER_ORDER.indexOf(m?.tier ?? "unknown");
  const sm = (m?: RankedMatchup) => m?.smoothed ?? 0.5;
  rows.sort((a, b) => {
    if (isTraining) {
      // Training: first matchups that are at least even, then highest practice need.
      const okA = tierIdx(a.m) <= 2 ? 0 : 1;
      const okB = tierIdx(b.m) <= 2 ? 0 : 1;
      const needA = PRACTICE_NEEDS.indexOf(a.e.practiceNeed ?? "medium");
      const needB = PRACTICE_NEEDS.indexOf(b.e.practiceNeed ?? "medium");
      return okA - okB || needA - needB || tierIdx(a.m) - tierIdx(b.m) || sm(b.m) - sm(a.m);
    }
    return (
      tierIdx(a.m) - tierIdx(b.m) || TIERS.indexOf(a.e.tier) - TIERS.indexOf(b.e.tier) || sm(b.m) - sm(a.m)
    );
  });

  const minGames = minGamesFor(vs?.enemyGames ?? 0);
  const allSolo = [...ranked.values()].filter((r) => r.agg.games > 0);
  const rareCount = allSolo.filter((r) => r.agg.games < minGames).length;
  // Rare picks (often off-role one-offs) are hidden unless asked for or searched.
  const soloRows = allSolo
    .filter((r) => showRare || filter || r.agg.games >= minGames)
    .sort((a, b) => b.smoothed - a.smoothed);
  const filterIds = filter ? new Set(searchChampions(champions, filter, 200).map((c) => champKey(c.id))) : null;
  const shownSolo = soloRows.filter((r) => !filterIds || filterIds.has(champKey(r.agg.championId)));
  const enemyGames = vs?.enemyGames ?? 0;

  return (
    <div className="pick-grid">
      <div>
        <div className="col-title">Your pool vs {enemy.name}</div>
        <div className="pick-list">
          {rows.map(({ e, m }) => {
            const c = lookup(e.championId);
            const own = ownVs.get(champKey(e.championId));
            const tier = m?.tier ?? "unknown";
            return (
              <Link
                key={e.championId}
                className="pick-row"
                style={{ textDecoration: "none", color: "inherit" }}
                href={`${base}/m/${e.role}/${encodeURIComponent(e.championId)}/${encodeURIComponent(enemy.id)}`}
              >
                <span className={`mtier mtier-${tier}`}>{MATCHUP_TIER_LABELS[tier]}</span>
                <Portrait champ={c} tier={e.tier} small />
                <div className="grow">
                  <div>
                    <b>{c?.name ?? e.championId}</b>{" "}
                    <span className="muted small" title="Your own games in this matchup">
                      ({own ? `${pct(own)} · ${own.games}` : "-"})
                    </span>
                  </div>
                  <div className="muted small">
                    {isTraining && <span>Practice: {PRACTICE_LABELS[e.practiceNeed ?? "medium"]} · </span>}
                    {m && m.agg.games > 0 ? (
                      <>
                        Master+ {pctNum(m.wr)} in {m.agg.games} games
                        {m.agg.games < LOW_SAMPLE && <span className="warn"> · few games</span>}
                      </>
                    ) : vs ? (
                      "No Master+ games in this matchup"
                    ) : (
                      "Loading…"
                    )}
                  </div>
                  {e.note && <div className="muted small note-line">{e.note}</div>}
                </div>
                <span className="muted">›</span>
              </Link>
            );
          })}
        </div>

        <div className="col-title" style={{ marginTop: 20 }}>
          Your best vs {enemy.name}
        </div>
        {ownTop3.length === 0 ? (
          <p className="muted small">You haven&apos;t played against {enemy.name} in this role yet.</p>
        ) : (
          <table className="stat-table">
            <tbody>
              {ownTop3.map(([cid, s]) => {
                const c = lookup(cid);
                return (
                  <tr key={cid}>
                    <td>
                      <div className="stat-champ">
                        <Portrait champ={c} small />
                        <span>{c?.name ?? cid}</span>
                      </div>
                    </td>
                    <td className="num muted">{s.games} games</td>
                    <td className={`num ${wrClass(s)}`}>{pct(s)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="card stat-card">
        <div className="stat-head">
          <h3>Solo Queue</h3>
          <span className="muted small">
            Master+ · {enemyGames} {enemy.name} games
          </span>
        </div>
        <input
          className="input"
          placeholder="Search champion…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ marginBottom: 8 }}
        />
        {!vs ? (
          <p className="muted small">Loading…</p>
        ) : shownSolo.length === 0 && rareCount === 0 ? (
          <p className="muted small">No Master+ games for this matchup yet.</p>
        ) : (
          <>
            <table className="stat-table">
              <thead>
                <tr className="muted small">
                  <td></td>
                  <td className="num">Pick</td>
                  <td className="num">Win</td>
                  <td className="num">Games</td>
                </tr>
              </thead>
              <tbody>
                {(showAll || filter ? shownSolo : shownSolo.slice(0, 20)).map((r) => {
                  const c = lookup(r.agg.championId);
                  const inPool = pool.some((e) => champKey(e.championId) === champKey(r.agg.championId));
                  return (
                    <tr key={r.agg.championId} className={inPool ? "in-pool-row" : ""}>
                      <td>
                        <div className="stat-champ">
                          <Portrait champ={c} small />
                          <span>{c?.name ?? r.agg.championId}</span>
                        </div>
                      </td>
                      <td className="num muted">{enemyGames ? pctNum(r.agg.games / enemyGames, 1) : "-"}</td>
                      <td className={`num ${r.agg.games >= LOW_SAMPLE ? wrCls(r.wr) : ""}`}>{pctNum(r.wr, 1)}</td>
                      <td className={`num ${r.agg.games < LOW_SAMPLE ? "warn" : "muted"}`}>
                        {r.agg.games}
                        {r.agg.games < LOW_SAMPLE && " ⚠"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!filter && shownSolo.length > 20 && (
              <button className="btn btn-ghost btn-sm" onClick={() => setShowAll((s) => !s)}>
                {showAll ? "Show less" : `Show all ${shownSolo.length}`}
              </button>
            )}
            {rareCount > 0 && !filter && (
              <button className="btn btn-ghost btn-sm" onClick={() => setShowRare((s) => !s)}>
                {showRare ? "Hide rare picks" : `Show ${rareCount} rare picks (< ${minGames} games)`}
              </button>
            )}
            <p className="muted small" style={{ marginBottom: 0 }}>
              Sorted by winrate adjusted for sample size. ⚠ = fewer than {LOW_SAMPLE} games.
            </p>
          </>
        )}
      </div>

      <div className="card stat-card">
        <div className="stat-head">
          <h3>Pro Play</h3>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Coming in a later update (LCK, LPL, LEC, LCS · last 10 patches).
        </p>
      </div>
    </div>
  );
}

function pctNum(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`;
}

function wrCls(wr: number): string {
  return wr >= 0.53 ? "wr-good" : wr < 0.47 ? "wr-bad" : "";
}
