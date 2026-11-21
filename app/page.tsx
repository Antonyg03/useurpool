"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { parseRiotId, profilePath } from "@/lib/riotId";
import { getRecent, type RecentAccount } from "@/lib/store";
import { REGIONS, type AccountType, type Region } from "@/lib/types";

export default function Home() {
  const router = useRouter();
  const [riotId, setRiotId] = useState("");
  const [region, setRegion] = useState<Region>("euw1");
  const [type, setType] = useState<AccountType>("main");
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<RecentAccount[]>([]);

  useEffect(() => setRecent(getRecent()), []);

  function submit(e: FormEvent) {
    e.preventDefault();
    const id = parseRiotId(riotId);
    if (!id) {
      setError('Enter your Riot ID as "Name#TAG".');
      return;
    }
    router.push(`${profilePath(region, id)}?type=${type}`);
  }

  return (
    <div className="hero">
      <div>
        <h1>Play your pool, not the meta.</h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: 24 }}>
          Set up the 3–5 champions you actually play. UseUrPool will tell you which of them to
          pick into the enemy laner, and what to practice on your training account.
        </p>
        <form className="card" onSubmit={submit}>
          <div className="field">
            <label htmlFor="riotId">Riot ID</label>
            <input
              id="riotId"
              className="input"
              placeholder="Name#TAG"
              value={riotId}
              autoComplete="off"
              onChange={(e) => {
                setRiotId(e.target.value);
                setError("");
              }}
            />
          </div>
          <div className="row" style={{ marginBottom: 16 }}>
            <div className="field grow" style={{ marginBottom: 0 }}>
              <label htmlFor="region">Region</label>
              <select
                id="region"
                className="select"
                value={region}
                onChange={(e) => setRegion(e.target.value as Region)}
              >
                {Object.entries(REGIONS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Account</label>
              <div className="segmented">
                <button
                  type="button"
                  className={type === "main" ? "active" : ""}
                  onClick={() => setType("main")}
                >
                  Main
                </button>
                <button
                  type="button"
                  className={type === "training" ? "active" : ""}
                  onClick={() => setType("training")}
                >
                  Training
                </button>
              </div>
            </div>
          </div>
          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary" type="submit" style={{ width: "100%" }}>
            Open my pool
          </button>
          <p className="muted small" style={{ marginBottom: 0 }}>
            No login needed. Account type only matters the first time you open an account.
          </p>
        </form>
      </div>
      <div className="card">
        <h2>Recent accounts</h2>
        {recent.length === 0 ? (
          <p className="muted small">Accounts you open will show up here.</p>
        ) : (
          <div className="recent">
            {recent.map((r) => (
              <Link
                key={`${r.gameName}#${r.tagLine}@${r.region}`}
                href={profilePath(r.region, r)}
              >
                <span>
                  {r.gameName}
                  <span className="muted">#{r.tagLine}</span>
                </span>
                <span className="row" style={{ gap: 6 }}>
                  <span className={`badge badge-${r.accountType}`}>{r.accountType}</span>
                  <span className="badge">{REGIONS[r.region]}</span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
