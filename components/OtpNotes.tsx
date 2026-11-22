"use client";

import { useCallback, useEffect, useState } from "react";
import type { Role } from "@/lib/types";

interface Note {
  id: string;
  text: string;
  source: string;
  created_at: string;
}

/** Statements from one-trick players about this matchup, collected by hand. */
export function OtpNotes({ role, champ, enemy, champName }: { role: Role; champ: string; enemy: string; champName: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [source, setSource] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    fetch(`/api/otpnotes?${new URLSearchParams({ role, champ, enemy })}`)
      .then((r) => r.json())
      .then((j) => setNotes(j.notes ?? []))
      .catch(() => {});
  }, [role, champ, enemy]);
  useEffect(load, [load]);

  async function save() {
    setErr("");
    const r = await fetch("/api/otpnotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role, champ, enemy, text, source }),
    }).catch(() => null);
    if (!r?.ok) return setErr("Could not save.");
    setText("");
    setSource("");
    setAdding(false);
    load();
  }

  async function remove(id: string) {
    await fetch(`/api/otpnotes?id=${id}`, { method: "DELETE" }).catch(() => null);
    load();
  }

  return (
    <div className="card stat-card" style={{ marginTop: 14 }}>
      <div className="stat-head">
        <h3>What one-tricks say</h3>
        {!adding && (
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>
            + Add
          </button>
        )}
      </div>
      {notes.length === 0 && !adding && (
        <p className="muted small" style={{ margin: 0 }}>
          Nothing yet. Heard a {champName} one-trick explain this matchup (stream, video, guide)? Add it here.
        </p>
      )}
      {notes.length > 0 && (
        <ul className="tips">
          {notes.map((n) => (
            <li key={n.id}>
              {n.text}
              {n.source && <span className="muted small"> · {n.source}</span>}{" "}
              <button className="btn btn-ghost btn-sm" onClick={() => remove(n.id)} title="Remove">
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <div>
          <textarea
            className="textarea"
            placeholder="e.g. “Max E first, only fight after his W is down”"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <input
              className="input grow"
              placeholder="Source (e.g. player name, video link)"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
            <button className="btn btn-sm" disabled={!text.trim()} onClick={save}>
              Save
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
          {err && <p className="error">{err}</p>}
        </div>
      )}
    </div>
  );
}
