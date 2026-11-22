"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { loadChampions, type Champion } from "@/lib/ddragon";
import { fromSlug, profilePath, regionFromUrl } from "@/lib/riotId";
import { loadProfile, rememberRecent, saveLocal, saveProfile, type StorageMode } from "@/lib/store";
import { presetFor } from "@/lib/presets";
import {
  PRACTICE_LABELS,
  PRACTICE_NEEDS,
  REGIONS,
  ROLES,
  ROLE_LABELS,
  TIERS,
  type AccountType,
  type PoolEntry,
  type Profile,
  type Role,
} from "@/lib/types";
import { ChampionSearch } from "./ChampionSearch";
import { GamesPanel } from "./GamesPanel";
import { PatchWarnings } from "./PatchWarnings";
import { fetchGames, runImport, type GamesResponse } from "@/lib/gamesClient";
import { champKey, counted, groupBy } from "@/lib/gameStats";
import { PoolCard } from "./PoolCard";

type SaveState = "idle" | "saving" | "saved" | "error";

const TIER_COLORS: Record<string, string> = {
  S: "conic-gradient(#ff4d4d, #ffd84d, #4dff88, #4dd2ff, #8a4dff, #ff4d4d)",
  A: "var(--tier-a)",
  B: "var(--tier-b)",
  C: "var(--tier-c)",
};
const NEED_COLORS: Record<string, string> = {
  high: "var(--need-high)",
  medium: "var(--need-medium)",
  some: "var(--need-some)",
  almost_done: "var(--need-almost)",
};

export function ProfileView() {
  const params = useParams<{ region: string; riotId: string }>();
  const search = useSearchParams();
  const region = regionFromUrl(params.region);
  const id = fromSlug(params.riotId);
  const requestedType: AccountType = search.get("type") === "training" ? "training" : "main";

  const [profile, setProfile] = useState<Profile | null>(null);
  const [mode, setMode] = useState<StorageMode>("local");
  const [loadError, setLoadError] = useState("");
  const [champions, setChampions] = useState<Champion[]>([]);
  const [champError, setChampError] = useState(false);
  const [role, setRole] = useState<Role>("top");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const dirty = useRef(false);
  const pending = useRef<Profile | null>(null);

  // If the tab is closed during the debounce window, send the last change now.
  useEffect(() => {
    const flush = () => {
      if (pending.current) {
        saveProfile(pending.current, mode).catch(() => {});
        pending.current = null;
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [mode]);

  // ---- Ranked games (phase 2) ----
  const [gamesInfo, setGamesInfo] = useState<GamesResponse | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [importError, setImportError] = useState("");
  const importSignal = useRef({ cancelled: false });

  const doImport = useCallback(
    async (mode: "full" | "new") => {
      if (!region || !id) return;
      setImportError("");
      setImporting(mode === "full" ? "Importing your ranked games…" : "Checking for new games…");
      const signal = { cancelled: false };
      importSignal.current = signal;
      try {
        await runImport(
          { gameName: id.gameName, tagLine: id.tagLine, region, accountType: requestedType },
          mode,
          (p) =>
            setImporting(
              p.waitingS
                ? `Imported ${p.imported} games. Riot rate limit, continuing in ${p.waitingS}s…`
                : `Imported ${p.imported} games…`,
            ),
          signal,
        );
        if (!signal.cancelled) setGamesInfo(await fetchGames(id.gameName, id.tagLine, region));
      } catch (e) {
        if (!signal.cancelled) setImportError(e instanceof Error ? e.message : "Import failed");
      } finally {
        if (!signal.cancelled) setImporting(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params.region, params.riotId],
  );

  useEffect(() => {
    if (!region || !id) return;
    let cancelled = false;
    fetchGames(id.gameName, id.tagLine, region)
      .then((info) => {
        if (cancelled) return;
        setGamesInfo(info);
        // Results come in automatically: check for new games on every visit.
        if (info.available && info.linked) doImport("new");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      importSignal.current.cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.region, params.riotId]);

  useEffect(() => {
    loadChampions()
      .then(setChampions)
      .catch(() => setChampError(true));
  }, []);

  useEffect(() => {
    if (!region || !id) return;
    let cancelled = false;
    loadProfile(id.gameName, id.tagLine, region)
      .then(({ profile: p, mode: m }) => {
        if (cancelled) return;
        setMode(m);
        const prof: Profile = p ?? {
          gameName: id.gameName,
          tagLine: id.tagLine,
          region,
          accountType: requestedType,
          pool: [],
        };
        setProfile(prof);
        rememberRecent(prof);
        const firstRole = prof.pool[0]?.role;
        if (firstRole && !prof.pool.some((e) => e.role === "top")) setRole(firstRole);
      })
      .catch(() => !cancelled && setLoadError("Could not load this account."));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.region, params.riotId]);

  // Debounced auto-save.
  useEffect(() => {
    if (!profile || !dirty.current) return;
    saveLocal(profile);
    pending.current = profile;
    setSaveState("saving");
    const t = setTimeout(() => {
      pending.current = null;
      saveProfile(profile, mode)
        .then(() => setSaveState("saved"))
        .catch(() => setSaveState("error"));
    }, 600);
    return () => clearTimeout(t);
  }, [profile, mode]);

  const update = useCallback((fn: (p: Profile) => Profile) => {
    dirty.current = true;
    setProfile((p) => (p ? fn(p) : p));
  }, []);

  const champById = useMemo(() => new Map(champions.map((c) => [c.id, c])), [champions]);
  const champByKey = useMemo(() => new Map(champions.map((c) => [champKey(c.id), c])), [champions]);
  const lookup = useCallback((cid: string) => champByKey.get(champKey(cid)), [champByKey]);
  const games = useMemo(() => gamesInfo?.games ?? [], [gamesInfo]);
  const poolWr = useMemo(
    () => groupBy(counted(games).filter((g) => g.role === role), (g) => champKey(g.championId)),
    [games, role],
  );
  const rolePool = useMemo(
    () => (profile?.pool ?? []).filter((e) => e.role === role).sort((a, b) => a.sortOrder - b.sortOrder),
    [profile, role],
  );
  const inPool = useMemo(() => new Set(rolePool.map((e) => e.championId)), [rolePool]);

  if (!region || !id) {
    return (
      <div className="card">
        <p>That Riot ID doesn&apos;t look right.</p>
        <Link href="/" className="btn">
          Back
        </Link>
      </div>
    );
  }
  if (loadError) return <p className="error">{loadError}</p>;
  if (!profile) return <p className="muted">Loading…</p>;

  const isTraining = profile.accountType === "training";

  function addChampion(c: Champion) {
    update((p) => ({
      ...p,
      pool: [
        ...p.pool,
        {
          role,
          championId: c.id,
          tier: isTraining ? "C" : "B",
          situational: false,
          practiceNeed: isTraining ? "high" : null,
          note: "",
          sortOrder: Math.max(0, ...p.pool.map((e) => e.sortOrder)) + 1,
        },
      ],
    }));
  }

  function patchEntry(championId: string, patch: Partial<PoolEntry>) {
    update((p) => ({
      ...p,
      pool: p.pool.map((e) => (e.role === role && e.championId === championId ? { ...e, ...patch } : e)),
    }));
  }

  function removeEntry(championId: string) {
    update((p) => ({
      ...p,
      pool: p.pool.filter((e) => !(e.role === role && e.championId === championId)),
    }));
  }

  function setAccountType(t: AccountType) {
    update((p) => ({
      ...p,
      accountType: t,
      pool: p.pool.map((e) => ({
        ...e,
        practiceNeed: t === "training" ? (e.practiceNeed ?? "medium") : e.practiceNeed,
      })),
    }));
    rememberRecent({ ...profile!, accountType: t });
  }

  function loadPreset() {
    const byName = new Map(champions.map((c) => [c.name.toLowerCase(), c]));
    const entries: PoolEntry[] = [];
    presetFor(profile!.accountType).forEach((pr, i) => {
      const c = byName.get(pr.name.toLowerCase());
      if (!c) return;
      const { name: _n, ...rest } = pr;
      entries.push({ ...rest, championId: c.id, sortOrder: i + 1 });
    });
    update((p) => ({ ...p, pool: [...p.pool.filter((e) => e.role !== "top"), ...entries] }));
    setRole("top");
  }

  const groups = isTraining
    ? PRACTICE_NEEDS.map((n) => ({
        key: n,
        label: `Practice need: ${PRACTICE_LABELS[n]}`,
        color: NEED_COLORS[n],
        entries: rolePool.filter((e) => (e.practiceNeed ?? "medium") === n),
      }))
    : TIERS.map((t) => ({
        key: t,
        label: `Comfort ${t}`,
        color: TIER_COLORS[t],
        entries: rolePool.filter((e) => e.tier === t),
      }));

  return (
    <div>
      <div className="profile-head">
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <span className="badge">{REGIONS[profile.region]}</span>
            <span className={`badge badge-${profile.accountType}`}>
              {isTraining ? "Training account" : "Main account"}
            </span>
          </div>
          <h1>
            {profile.gameName}
            <span className="muted">#{profile.tagLine}</span>
          </h1>
          <p className="muted small" style={{ margin: 0 }}>
            {isTraining
              ? "Champions you are learning. Move them along as they get better."
              : "Your pool. The frame shows how comfortable you are on each champion."}
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <Link
            href={`${profilePath(profile.region, profile)}/pick`}
            className="btn btn-primary"
            style={{ display: "inline-block", textDecoration: "none", marginBottom: 10, marginRight: 8 }}
          >
            Champ select →
          </Link>
          <Link
            href={`${profilePath(profile.region, profile)}/tiers`}
            className="btn"
            style={{ display: "inline-block", textDecoration: "none", marginBottom: 10, marginRight: 8 }}
          >
            Tier list
          </Link>
          <div className="segmented" style={{ marginBottom: 6 }}>
            <button className={!isTraining ? "active" : ""} onClick={() => setAccountType("main")}>
              Main
            </button>
            <button className={isTraining ? "active" : ""} onClick={() => setAccountType("training")}>
              Training
            </button>
          </div>
          <div className={`save-state ${saveState === "error" ? "err" : ""}`}>
            {saveState === "saving" && "Saving…"}
            {saveState === "saved" && (mode === "cloud" ? "Saved" : "Saved in this browser")}
            {saveState === "error" && "Could not save. Check your connection."}
          </div>
        </div>
      </div>

      {mode === "local" && (
        <div className="notice">
          Database not connected yet: changes are saved in this browser only.
        </div>
      )}
      {champError && (
        <div className="notice error">Could not load champion data. Reload the page to try again.</div>
      )}

      <div className="tabs">
        {ROLES.map((r) => {
          const n = profile.pool.filter((e) => e.role === r).length;
          return (
            <button key={r} className={role === r ? "active" : ""} onClick={() => setRole(r)}>
              {ROLE_LABELS[r]}
              {n > 0 && <span className="count">{n}</span>}
            </button>
          );
        })}
      </div>

      {gamesInfo && gamesInfo.reason !== "database" && (
        <>
          <div className="games-bar">
            {gamesInfo.reason === "riot" ? (
              <span className="muted small">Riot API key not set yet, so games can&apos;t be imported.</span>
            ) : importing ? (
              <span className="muted small">{importing}</span>
            ) : gamesInfo.linked && games.length > 0 ? (
              <>
                <span className="muted small">{counted(games).length} ranked solo games imported</span>
                <button className="btn btn-sm" onClick={() => doImport("new")}>
                  Check for new games
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => doImport("full")} title="Fetches older games that are still missing">
                  Re-scan history
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-primary btn-sm" onClick={() => doImport("full")}>
                  Import my ranked games
                </button>
                <span className="muted small">Loads your Ranked Solo history from Riot. Takes a few minutes.</span>
              </>
            )}
            {importError && <span className="error">{importError}</span>}
          </div>
          {games.length > 0 && (
            <GamesPanel role={role} games={games} champions={champions} lookup={lookup} />
          )}
        </>
      )}

      {mode === "cloud" && (
        <PatchWarnings role={role} champIds={rolePool.map((e) => e.championId)} lookup={lookup} />
      )}

      <div className="row" style={{ marginBottom: 22, alignItems: "flex-start" }}>
        <div className="grow" style={{ maxWidth: 420 }}>
          <ChampionSearch
            champions={champions}
            inPool={inPool}
            onPick={addChampion}
            placeholder={`Add a ${ROLE_LABELS[role]} champion…`}
          />
        </div>
        {rolePool.length === 0 && role === "top" && champions.length > 0 && (
          <button className="btn" onClick={loadPreset}>
            Load suggested Top pool
          </button>
        )}
        {!isTraining && rolePool.length > 0 && (rolePool.length < 3 || rolePool.length > 7) && (
          <span className="muted small" style={{ alignSelf: "center" }}>
            Tip: 3–5 main champions per role work best.
          </span>
        )}
      </div>

      {rolePool.length === 0 ? (
        <p className="muted">No {ROLE_LABELS[role]} champions yet. Search above to add one.</p>
      ) : (
        groups.map((g) => (
          <div className="section" key={g.key}>
            <div className="section-title">
              <span className="dot" style={{ background: g.color }} />
              {g.label}
              <span className="muted small">{g.entries.length}</span>
            </div>
            {g.entries.length === 0 ? (
              <div className="empty-slot">—</div>
            ) : (
              <div className="grid">
                {g.entries.map((e) => (
                  <PoolCard
                    key={e.championId}
                    entry={e}
                    champ={champById.get(e.championId)}
                    stat={poolWr.get(champKey(e.championId))}
                    accountType={profile.accountType}
                    onChange={(patch) => patchEntry(e.championId, patch)}
                    onRemove={() => removeEntry(e.championId)}
                  />
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
