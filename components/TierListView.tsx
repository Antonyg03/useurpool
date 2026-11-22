"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { loadChampions, type Champion } from "@/lib/ddragon";
import { fromSlug, profilePath, regionFromUrl } from "@/lib/riotId";
import { loadProfile } from "@/lib/store";
import { autoTiers, type AutoTier, type ChampPatchRow } from "@/lib/champTrends";
import { fetchChampStats } from "@/lib/champStatsClient";
import { champKey } from "@/lib/gameStats";
import { ROLES, ROLE_LABELS, type Profile, type Role } from "@/lib/types";
import { Portrait } from "./Portrait";

const TIERS: AutoTier[] = ["S", "A", "B", "C", "D"];

export function TierListView() {
  const params = useParams<{ region: string; riotId: string }>();
  const region = regionFromUrl(params.region);
  const id = fromSlug(params.riotId);
  const [role, setRole] = useState<Role>("top");
  const [statRegion, setStatRegion] = useState("all");
  const [champions, setChampions] = useState<Champion[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [data, setData] = useState<{ patches: string[]; rows: ChampPatchRow[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    loadChampions().then(setChampions).catch(() => {});
    if (region && id) loadProfile(id.gameName, id.tagLine, region).then(({ profile: p }) => setProfile(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setData(null);
    setError("");
    fetchChampStats(role, statRegion).then(setData).catch((e) => setError(e.message));
  }, [role, statRegion]);

  const lookup = useMemo(() => {
    const m = new Map(champions.map((c) => [champKey(c.id), c]));
    return (cid: string) => m.get(champKey(cid));
  }, [champions]);
  const mine = new Set((profile?.pool ?? []).filter((e) => e.role === role).map((e) => champKey(e.championId)));
  const tiers = useMemo(() => (data ? autoTiers(data.rows) : []), [data]);

  if (!region || !id) return <p className="error">This link doesn&apos;t look right.</p>;

  return (
    <div>
      <Link href={profilePath(region, id)} className="muted small" style={{ textDecoration: "none" }}>
        ← {id.gameName}#{id.tagLine} · pool
      </Link>
      <div className="profile-head" style={{ marginTop: 6 }}>
        <div>
          <h1>Tier list</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Automatic, from Master+ win and pick rates{data?.patches.length ? ` · patches ${data.patches.join(", ")}` : ""}.
            Only for inspiration: your comfort tiers stay yours. Your pool is outlined.
          </p>
        </div>
        <div className="segmented">
          {[
            ["euw1", "EUW"],
            ["kr", "KR"],
            ["all", "EUW + KR"],
          ].map(([k, l]) => (
            <button key={k} className={statRegion === k ? "active" : ""} onClick={() => setStatRegion(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="tabs">
        {ROLES.map((r) => (
          <button key={r} className={role === r ? "active" : ""} onClick={() => setRole(r)}>
            {ROLE_LABELS[r]}
          </button>
        ))}
      </div>
      {error && <div className="notice error">{error}</div>}
      {!data ? (
        <p className="muted">Loading…</p>
      ) : tiers.length === 0 ? (
        <p className="muted">Not enough Master+ games yet.</p>
      ) : (
        TIERS.map((t) => {
          const list = tiers.filter((x) => x.tier === t);
          return (
            <div key={t} className="tier-row">
              <div className={`tier-letter tl-${t}`}>{t}</div>
              <div className="tier-champs">
                {list.map((x) => {
                  const c = lookup(x.championId);
                  return (
                    <div
                      key={x.championId}
                      className={`tier-champ ${mine.has(champKey(x.championId)) ? "mine" : ""}`}
                      title={`${(x.wr * 100).toFixed(1)}% win · ${(x.pickRate * 100).toFixed(1)}% pick · ${x.games} games`}
                    >
                      <Portrait champ={c} />
                      <span>{c?.name ?? x.championId}</span>
                      <span className="muted">{(x.wr * 100).toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
