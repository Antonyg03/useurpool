"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { loadChampions, loadItems, loadRunes, type Champion, type NamedIcon } from "@/lib/ddragon";
import { fromSlug, profilePath, regionFromUrl } from "@/lib/riotId";
import { fetchGames } from "@/lib/gamesClient";
import type { PlayerGame } from "@/lib/games";
import { champKey, counted, pct, total } from "@/lib/gameStats";
import type { BuildRow, MatchupResponse } from "@/lib/matchupTypes";
import { draftTips } from "@/lib/laneTips";
import { LOW_SAMPLE } from "@/lib/matchupTiers";
import { ROLES, ROLE_LABELS, type Role } from "@/lib/types";
import { Portrait } from "./Portrait";
import { wrClass } from "./GamesPanel";

type StatRegion = "euw1" | "kr" | "all";

/** Below this many games of a build kind in the matchup, show the champion-wide numbers. */
const BUILD_MIN = 20;
/** Outscale/falls-off only when the win rate gap between short and long games is this big. */
const SCALING_GAP = 0.05;

export function MatchupView() {
  const params = useParams<{ region: string; riotId: string; role: string; champ: string; enemy: string }>();
  const region = regionFromUrl(params.region);
  const id = fromSlug(params.riotId);
  const role = (ROLES as readonly string[]).includes(params.role) ? (params.role as Role) : null;
  const champId = decodeURIComponent(params.champ);
  const enemyId = decodeURIComponent(params.enemy);

  const [champions, setChampions] = useState<Champion[]>([]);
  const [items, setItems] = useState<Map<string, NamedIcon>>(new Map());
  const [runes, setRunes] = useState<Map<string, NamedIcon>>(new Map());
  const [data, setData] = useState<MatchupResponse | null>(null);
  const [error, setError] = useState("");
  const [games, setGames] = useState<PlayerGame[]>([]);
  const [statRegion, setStatRegion] = useState<StatRegion>("all");

  useEffect(() => {
    loadChampions().then(setChampions).catch(() => {});
    loadItems().then(setItems).catch(() => {});
    loadRunes().then(setRunes).catch(() => {});
    try {
      const r = localStorage.getItem("uup:statRegion");
      if (r === "euw1" || r === "kr" || r === "all") setStatRegion(r);
    } catch {}
  }, []);

  useEffect(() => {
    if (!region || !id) return;
    fetchGames(id.gameName, id.tagLine, region)
      .then((g) => setGames(g.games))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.region, params.riotId]);

  useEffect(() => {
    if (!role) return;
    setData(null);
    setError("");
    const qs = new URLSearchParams({ role, champ: champId, enemy: enemyId, region: statRegion });
    fetch(`/api/matchup?${qs}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Could not load matchup");
        setData(j);
      })
      .catch((e) => setError(e.message));
  }, [role, champId, enemyId, statRegion]);

  const lookup = useMemo(() => {
    const m = new Map(champions.map((c) => [champKey(c.id), c]));
    return (cid: string) => m.get(champKey(cid));
  }, [champions]);

  if (!region || !id || !role) return <p className="error">This link doesn&apos;t look right.</p>;

  const champ = lookup(champId);
  const enemy = lookup(enemyId);
  const champName = champ?.name ?? champId;
  const enemyName = enemy?.name ?? enemyId;

  const myGames = counted(games).filter(
    (g) =>
      g.role === role &&
      champKey(g.championId) === champKey(champId) &&
      g.opponentChampionId &&
      champKey(g.opponentChampionId) === champKey(enemyId),
  );
  const mine = total(myGames);

  function changeRegion(r: StatRegion) {
    setStatRegion(r);
    try {
      localStorage.setItem("uup:statRegion", r);
    } catch {}
  }

  return (
    <div>
      <Link href={`${profilePath(region, id)}/pick`} className="muted small" style={{ textDecoration: "none" }}>
        ← Champ select
      </Link>
      <div className="profile-head" style={{ marginTop: 10 }}>
        <div className="row" style={{ gap: 14 }}>
          <Portrait champ={champ} />
          <div>
            <h1 style={{ margin: 0 }}>
              {champName} <span className="muted">vs</span> {enemyName}
            </h1>
            <div className="muted small">
              {ROLE_LABELS[role]} · Master+{" "}
              {data && data.stats.games > 0 ? (
                <>
                  <b className={wrClassRaw(data.stats.wins / data.stats.games, data.stats.games)}>
                    {pctNum(data.stats.wins / data.stats.games, 1)}
                  </b>{" "}
                  in {data.stats.games} games
                </>
              ) : (
                "no games yet"
              )}
              {data?.patches.length ? ` · patches ${data.patches.join(", ")}` : ""}
              {" · "}You: {mine.games ? `${pct(mine)} in ${mine.games}` : "no games"}
            </div>
          </div>
          <Portrait champ={enemy} />
        </div>
        <div className="segmented" aria-label="Stats region">
          {(["euw1", "kr", "all"] as StatRegion[]).map((r) => (
            <button key={r} className={statRegion === r ? "active" : ""} onClick={() => changeRegion(r)}>
              {r === "euw1" ? "EUW" : r === "kr" ? "KR" : "EUW + KR"}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}

      <NotesCard
        gameName={id.gameName}
        tagLine={id.tagLine}
        region={region}
        role={role}
        champ={champId}
        enemy={enemyId}
        enemyName={enemyName}
      />

      <div className="mv-grid">
        <LevelOne data={data} items={items} champName={champName} enemyName={enemyName} />
        <PowerSpikes data={data} champName={champName} />
      </div>

      <LaneTips data={data} champId={champId} enemyId={enemyId} champName={champName} enemyName={enemyName} />

      <Builds data={data} items={items} runes={runes} />

      {myGames.length > 0 && (
        <div className="card stat-card" style={{ marginTop: 14 }}>
          <div className="stat-head">
            <h3>Your games</h3>
            <span className="muted small">
              {mine.games} games · <b className={wrClass(mine)}>{pct(mine)}</b>
            </span>
          </div>
          <table className="stat-table">
            <tbody>
              {myGames.slice(0, 10).map((g) => (
                <tr key={g.matchId}>
                  <td className={g.win ? "wr-good" : "wr-bad"}>{g.win ? "Win" : "Loss"}</td>
                  <td className="num muted">
                    {g.kills}/{g.deaths}/{g.assists}
                  </td>
                  <td className="num muted">{Math.round(g.durationS / 60)} min</td>
                  <td className="num muted">{new Date(g.playedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Feedback
        gameName={id.gameName}
        tagLine={id.tagLine}
        region={region}
        role={role}
        champ={champId}
        enemy={enemyId}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function NotesCard(props: {
  gameName: string;
  tagLine: string;
  region: string;
  role: Role;
  champ: string;
  enemy: string;
  enemyName: string;
}) {
  const [note, setNote] = useState("");
  const [state, setState] = useState<"loading" | "idle" | "saving" | "saved" | "error" | "off">("loading");
  const dirty = useRef(false);
  const key = useMemo(
    () =>
      new URLSearchParams({
        gameName: props.gameName,
        tagLine: props.tagLine,
        region: props.region,
        role: props.role,
        champ: props.champ,
        enemy: props.enemy,
      }),
    [props.gameName, props.tagLine, props.region, props.role, props.champ, props.enemy],
  );

  useEffect(() => {
    dirty.current = false;
    fetch(`/api/notes?${key}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.configured === false) return setState("off");
        setNote(j.note ?? "");
        setState("idle");
      })
      .catch(() => setState("error"));
  }, [key]);

  useEffect(() => {
    if (!dirty.current) return;
    setState("saving");
    const t = setTimeout(() => {
      fetch("/api/notes", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...Object.fromEntries(key), note }),
        keepalive: true,
      })
        .then((r) => setState(r.ok ? "saved" : "error"))
        .catch(() => setState("error"));
    }, 700);
    return () => clearTimeout(t);
  }, [note, key]);

  return (
    <div className="card notes-card">
      <div className="stat-head">
        <h3>Your notes</h3>
        <span className={`save-state ${state === "error" ? "err" : ""}`}>
          {state === "saving" && "Saving…"}
          {state === "saved" && "Saved"}
          {state === "error" && "Could not save"}
          {state === "off" && "Database not connected"}
        </span>
      </div>
      <textarea
        className="textarea"
        style={{ minHeight: 80 }}
        placeholder={`What works for you against ${props.enemyName}? e.g. “Take Second Wind, freeze, wait for his E”`}
        value={note}
        disabled={state === "loading" || state === "off"}
        onChange={(e) => {
          dirty.current = true;
          setNote(e.target.value);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function LevelOne({
  data,
  items,
  champName,
  enemyName,
}: {
  data: MatchupResponse | null;
  items: Map<string, NamedIcon>;
  champName: string;
  enemyName: string;
}) {
  const e = data?.early;
  let verdict: { label: string; cls: string; text: string } | null = null;
  if (e && e.games >= 10) {
    const fbEdge = e.fbFor - e.fbAgainst;
    if (e.gold3 > 100 || fbEdge >= 0.05) {
      verdict = {
        label: "You win early",
        cls: "light-green",
        text: `${champName} is usually ahead at 3:00. Look for trades and level 2–3 all-ins.`,
      };
    } else if (e.gold3 < -100 || fbEdge <= -0.05) {
      verdict = {
        label: "Play safe early",
        cls: "light-red",
        text: `${enemyName} usually wins the first minutes. Give up a few CS if needed and don't take level 1–3 fights.`,
      };
    } else {
      verdict = {
        label: "Even early",
        cls: "light-yellow",
        text: "Neither side has a clear early advantage. Play for waves and cooldowns.",
      };
    }
  }
  const start = topBuild(data?.builds ?? [], "start");
  const skill = topBuild(data?.builds ?? [], "skill_start");

  return (
    <div className="card stat-card">
      <div className="stat-head">
        <h3>Level 1</h3>
        <span className="muted small">{e ? `${e.games} games with timeline` : ""}</span>
      </div>
      {!e ? (
        <p className="muted small">No early-game data yet. It is collected from match timelines.</p>
      ) : (
        <>
          {verdict ? (
            <div className="verdict">
              <span className={`light ${verdict.cls}`} />
              <div>
                <b>{verdict.label}</b>
                <div className="muted small">{verdict.text}</div>
              </div>
            </div>
          ) : (
            <p className="muted small">Only {e.games} games so far, too few for a recommendation.</p>
          )}
          <div className="kv">
            <span>Gold at 3:00</span>
            <b className={e.gold3 > 50 ? "wr-good" : e.gold3 < -50 ? "wr-bad" : ""}>{signed(e.gold3)}</b>
            <span>XP at 3:00</span>
            <b className={e.xp3 > 30 ? "wr-good" : e.xp3 < -30 ? "wr-bad" : ""}>{signed(e.xp3)}</b>
            <span>Lane first blood before 4:00</span>
            <b>
              <span className="wr-good">{pctNum(e.fbFor)} you</span> ·{" "}
              <span className="wr-bad">{pctNum(e.fbAgainst)} them</span>
            </b>
          </div>
        </>
      )}
      {(start || skill) && (
        <div style={{ marginTop: 12 }}>
          {start && (
            <div className="row" style={{ gap: 8, marginBottom: 6 }}>
              <span className="muted small" style={{ width: 64 }}>
                Start
              </span>
              <ItemList ids={start.row.value.split("+")} items={items} />
              <Evidence row={start.row} share={start.share} fallback={start.fallback} />
            </div>
          )}
          {skill && (
            <div className="row" style={{ gap: 8 }}>
              <span className="muted small" style={{ width: 64 }}>
                Skills
              </span>
              <span className="skill-seq">{skill.row.value.split("").join(" → ")}</span>
              <Evidence row={skill.row} share={skill.share} fallback={skill.fallback} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PowerSpikes({ data, champName }: { data: MatchupResponse | null; champName: string }) {
  const s = data?.stats;
  if (!s || s.games === 0) {
    return (
      <div className="card stat-card">
        <div className="stat-head">
          <h3>Power spikes</h3>
        </div>
        <p className="muted small">No Master+ games for this matchup yet.</p>
      </div>
    );
  }
  const gamesMid = s.games - s.gamesShort - s.gamesLong;
  const winsMid = s.wins - s.winsShort - s.winsLong;
  const phases = [
    { label: "Early game", sub: "ends before 25 min", g: s.gamesShort, w: s.winsShort },
    { label: "Mid game", sub: "25–32 min", g: gamesMid, w: winsMid },
    { label: "Late game", sub: "32+ min", g: s.gamesLong, w: s.winsLong },
  ];
  const wrShort = s.gamesShort ? s.winsShort / s.gamesShort : null;
  const wrLong = s.gamesLong ? s.winsLong / s.gamesLong : null;
  let scaling: string | null = null;
  if (wrShort !== null && wrLong !== null && s.gamesShort >= 20 && s.gamesLong >= 20) {
    if (wrLong - wrShort > SCALING_GAP) scaling = `${champName} outscales: +${pctNum(wrLong - wrShort)} in long games.`;
    else if (wrShort - wrLong > SCALING_GAP)
      scaling = `${champName} falls off: ${pctNum(wrShort - wrLong)} worse in long games. Try to end early.`;
  }
  return (
    <div className="card stat-card">
      <div className="stat-head">
        <h3>Power spikes</h3>
        <span className="muted small">win rate by game length</span>
      </div>
      <div className="phases">
        {phases.map((p) => {
          const wr = p.g ? p.w / p.g : null;
          const cls =
            wr === null || p.g < 10 ? "light-grey" : wr >= 0.52 ? "light-green" : wr < 0.48 ? "light-red" : "light-yellow";
          return (
            <div key={p.label} className="phase">
              <span className={`light ${cls}`} />
              <div>
                <b>{p.label}</b> <span className="muted small">{p.sub}</span>
                <div className="small">
                  {wr === null ? (
                    <span className="muted">no games</span>
                  ) : (
                    <>
                      {pctNum(wr, 1)}{" "}
                      <span className={p.g < LOW_SAMPLE ? "warn" : "muted"}>
                        ({p.g} games{p.g < LOW_SAMPLE ? " ⚠" : ""})
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <p className="small" style={{ marginBottom: 0 }}>
        {scaling ?? <span className="muted">No clear scaling difference (needs more than 5% gap).</span>}
      </p>
    </div>
  );
}

function LaneTips({
  data,
  champId,
  enemyId,
  champName,
  enemyName,
}: {
  data: MatchupResponse | null;
  champId: string;
  enemyId: string;
  champName: string;
  enemyName: string;
}) {
  const auto: string[] = [];
  const e = data?.early;
  if (e && e.games >= 10) {
    if (e.fbAgainst >= 0.15) auto.push(`${enemyName} gets lane first blood before 4:00 in ${pctNum(e.fbAgainst)} of games. Respect the early all-in.`);
    if (e.fbFor >= 0.15) auto.push(`You get lane first blood before 4:00 in ${pctNum(e.fbFor)} of games. The early kill is there if you play for it.`);
  }
  const s = data?.stats;
  const o = data?.overall;
  if (s && o && s.games >= 50 && o.games >= 200) {
    const diff = s.wins / s.games - o.wins / o.games;
    if (diff <= -0.03) auto.push(`${champName} wins ${pctNum(-diff)} less against ${enemyName} than on average. A hard matchup in Master+.`);
    if (diff >= 0.03) auto.push(`${champName} wins ${pctNum(diff)} more against ${enemyName} than on average. A good counter pick.`);
  }
  const drafts = draftTips(champId, enemyId);
  return (
    <div className="card stat-card" style={{ marginTop: 14 }}>
      <div className="stat-head">
        <h3>Lane tips</h3>
      </div>
      {auto.length === 0 && drafts.length === 0 && (
        <p className="muted small">No tips for this matchup yet. Write what you learn in your notes above.</p>
      )}
      {auto.length > 0 && (
        <>
          <div className="muted small" style={{ marginBottom: 4 }}>From the data</div>
          <ul className="tips">
            {auto.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </>
      )}
      {drafts.length > 0 && (
        <>
          <div className="muted small" style={{ marginBottom: 4 }}>
            General tips (a starting point; your notes win)
          </div>
          <ul className="tips">
            {drafts.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const BUILD_SECTIONS: { kind: BuildRow["kind"]; title: string }[] = [
  { kind: "runes", title: "Runes (keystone + second tree)" },
  { kind: "items", title: "First two items" },
  { kind: "start", title: "Starting items" },
  { kind: "skill_max", title: "Skill max order" },
];

function Builds({
  data,
  items,
  runes,
}: {
  data: MatchupResponse | null;
  items: Map<string, NamedIcon>;
  runes: Map<string, NamedIcon>;
}) {
  const builds = data?.builds ?? [];
  return (
    <div className="card stat-card" style={{ marginTop: 14 }}>
      <div className="stat-head">
        <h3>Build</h3>
        <span className="muted small">Master+, EUW + KR combined, newest 3 patches</span>
      </div>
      {builds.length === 0 ? (
        <p className="muted small">No build data yet. It is collected together with the early-game data.</p>
      ) : (
        <div className="build-grid">
          {BUILD_SECTIONS.map(({ kind, title }) => {
            const { rows, fallback, totalGames } = buildRows(builds, kind);
            return (
              <div key={kind}>
                <div className="muted small" style={{ marginBottom: 6 }}>
                  {title}
                  {fallback && <span className="warn"> · all matchups (few games vs this enemy)</span>}
                </div>
                {rows.length === 0 ? (
                  <p className="muted small">No data.</p>
                ) : (
                  <table className="stat-table">
                    <tbody>
                      {rows.slice(0, 3).map((r) => (
                        <tr key={r.value}>
                          <td>
                            <BuildValue kind={kind} value={r.value} items={items} runes={runes} />
                          </td>
                          <td className="num muted" title="How often this is played">
                            {pctNum(r.games / totalGames)}
                          </td>
                          <td className={`num ${wrClassRaw(r.wins / r.games, r.games)}`}>{pctNum(r.wins / r.games, 1)}</td>
                          <td className={`num ${r.games < LOW_SAMPLE ? "warn" : "muted"}`}>{r.games}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BuildValue({
  kind,
  value,
  items,
  runes,
}: {
  kind: BuildRow["kind"];
  value: string;
  items: Map<string, NamedIcon>;
  runes: Map<string, NamedIcon>;
}) {
  if (kind === "runes" || kind === "keystone") {
    return (
      <span className="row" style={{ gap: 4 }}>
        {value.split(":").map((rid) => {
          const r = runes.get(rid);
          // eslint-disable-next-line @next/next/no-img-element
          return r ? <img key={rid} src={r.icon} alt={r.name} title={r.name} className="icon" /> : <span key={rid}>{rid}</span>;
        })}
        <span className="small">{runes.get(value.split(":")[0])?.name ?? ""}</span>
      </span>
    );
  }
  if (kind === "items") return <ItemList ids={value.split(">")} items={items} arrows />;
  if (kind === "start") return <ItemList ids={value.split("+")} items={items} />;
  return <span className="skill-seq">{value.replace(/>/g, " > ")}</span>;
}

function ItemList({ ids, items, arrows }: { ids: string[]; items: Map<string, NamedIcon>; arrows?: boolean }) {
  return (
    <span className="row" style={{ gap: 4 }}>
      {ids.map((iid, i) => {
        const it = items.get(iid);
        return (
          <span key={`${iid}-${i}`} className="row" style={{ gap: 4 }}>
            {arrows && i > 0 && <span className="muted">›</span>}
            {it ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={it.icon} alt={it.name} title={it.name} className="icon" />
            ) : (
              <span className="small">{iid}</span>
            )}
          </span>
        );
      })}
    </span>
  );
}

function Evidence({ row, share, fallback }: { row: BuildRow; share: number; fallback: boolean }) {
  return (
    <span className="muted small">
      {pctNum(share)} pick ·{" "}
      <span className={wrClassRaw(row.wins / row.games, row.games)}>{pctNum(row.wins / row.games, 1)} win</span> ·{" "}
      <span className={row.games < LOW_SAMPLE ? "warn" : ""}>{row.games} games</span>
      {fallback && <span className="warn"> · all matchups</span>}
    </span>
  );
}

// ---------------------------------------------------------------------------

function Feedback(props: { gameName: string; tagLine: string; region: string; role: Role; champ: string; enemy: string }) {
  const [helpful, setHelpful] = useState<boolean | null>(null);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState(false);

  const send = useCallback(
    async (h: boolean | null, c: string) => {
      setErr(false);
      const r = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...props, helpful: h, comment: c }),
      }).catch(() => null);
      if (r?.ok) setSent(true);
      else setErr(true);
    },
    [props],
  );

  return (
    <div className="card stat-card" style={{ marginTop: 14 }}>
      {sent ? (
        <p className="small" style={{ margin: 0 }}>
          Thanks, feedback saved.
        </p>
      ) : (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <b className="small">Was this page helpful?</b>
            <button className={`btn btn-sm ${helpful === true ? "badge-main" : ""}`} onClick={() => setHelpful(true)}>
              👍 Yes
            </button>
            <button className={`btn btn-sm ${helpful === false ? "badge-sit" : ""}`} onClick={() => setHelpful(false)}>
              👎 No
            </button>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input grow"
              placeholder="What was wrong or missing? (optional)"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
            <button className="btn btn-sm" disabled={helpful === null && !comment.trim()} onClick={() => send(helpful, comment)}>
              Send
            </button>
          </div>
          {err && <p className="error">Could not send feedback.</p>}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function buildRows(builds: BuildRow[], kind: BuildRow["kind"]) {
  const matchup = builds.filter((b) => b.scope === "matchup" && b.kind === kind);
  const matchupGames = matchup.reduce((s, r) => s + r.games, 0);
  const fallback = matchupGames < BUILD_MIN;
  const rows = (fallback ? builds.filter((b) => b.scope === "champion" && b.kind === kind) : matchup).sort(
    (a, b) => b.games - a.games,
  );
  const totalGames = rows.reduce((s, r) => s + r.games, 0) || 1;
  return { rows, fallback, totalGames };
}

function topBuild(builds: BuildRow[], kind: BuildRow["kind"]) {
  const { rows, fallback, totalGames } = buildRows(builds, kind);
  if (!rows.length) return null;
  return { row: rows[0], share: rows[0].games / totalGames, fallback };
}

function pctNum(v: number, digits = 0): string {
  return `${(v * 100).toFixed(digits)}%`;
}

function signed(v: number): string {
  const r = Math.round(v);
  return r > 0 ? `+${r}` : String(r);
}

function wrClassRaw(wr: number, games: number): string {
  if (games < LOW_SAMPLE) return "";
  return wr >= 0.53 ? "wr-good" : wr < 0.47 ? "wr-bad" : "";
}
