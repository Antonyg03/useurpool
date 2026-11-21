"use client";

import { useState } from "react";
import type { Champion } from "@/lib/ddragon";
import {
  PRACTICE_LABELS,
  PRACTICE_NEEDS,
  TIERS,
  type AccountType,
  type PoolEntry,
  type PracticeNeed,
} from "@/lib/types";
import { Portrait } from "./Portrait";

export function PoolCard({
  entry,
  champ,
  accountType,
  onChange,
  onRemove,
}: {
  entry: PoolEntry;
  champ: Champion | undefined;
  accountType: AccountType;
  onChange: (patch: Partial<PoolEntry>) => void;
  onRemove: () => void;
}) {
  const [showNote, setShowNote] = useState(entry.note.length > 0);
  const need = entry.practiceNeed ?? "medium";
  const needIdx = PRACTICE_NEEDS.indexOf(need);

  function moveNeed(delta: number) {
    const next = PRACTICE_NEEDS[needIdx + delta] as PracticeNeed | undefined;
    if (next) onChange({ practiceNeed: next });
  }

  return (
    <div className="champ" data-champ={entry.championId}>
      <div className="champ-top">
        <Portrait champ={champ} tier={entry.tier} />
        <div className="grow">
          <div className="champ-name">{champ?.name ?? entry.championId}</div>
          <div className="row" style={{ gap: 6, marginTop: 4 }}>
            {accountType === "main" && entry.situational && (
              <span className="badge badge-sit">situational</span>
            )}
            {accountType === "training" && (
              <span className="badge">Comfort {entry.tier}</span>
            )}
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onRemove} title="Remove from pool">
          ✕
        </button>
      </div>

      {accountType === "main" ? (
        <div className="champ-controls">
          <div className="tier-pick" aria-label="Comfort tier">
            {TIERS.map((t) => (
              <button
                key={t}
                className={`t-${t} ${entry.tier === t ? "active" : ""}`}
                onClick={() => onChange({ tier: t })}
                title={`Comfort ${t}`}
              >
                {t}
              </button>
            ))}
          </div>
          <button
            className={`btn btn-sm ${entry.situational ? "badge-sit" : ""}`}
            onClick={() => onChange({ situational: !entry.situational })}
            title="Only good in specific matchups"
          >
            {entry.situational ? "Situational ✓" : "Situational"}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowNote((s) => !s)}>
            Note
          </button>
        </div>
      ) : (
        <div className="champ-controls">
          <button
            className="btn btn-sm"
            disabled={needIdx <= 0}
            onClick={() => moveNeed(-1)}
            title="Needs more practice"
          >
            ← More practice
          </button>
          <button
            className="btn btn-sm"
            disabled={needIdx >= PRACTICE_NEEDS.length - 1}
            onClick={() => moveNeed(1)}
            title="Needs less practice"
          >
            Less practice →
          </button>
          <select
            className="select btn-sm"
            style={{ width: "auto", padding: "4px 8px" }}
            value={entry.tier}
            onChange={(e) => onChange({ tier: e.target.value as PoolEntry["tier"] })}
            aria-label="Comfort tier"
          >
            {TIERS.map((t) => (
              <option key={t} value={t}>
                Comfort {t}
              </option>
            ))}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowNote((s) => !s)}>
            Note
          </button>
        </div>
      )}

      {showNote && (
        <textarea
          className="textarea"
          placeholder={
            accountType === "main"
              ? "When do you pick this? e.g. “Great vs Camille”"
              : "What are you working on? e.g. “Wave management”"
          }
          value={entry.note}
          onChange={(e) => onChange({ note: e.target.value })}
        />
      )}
      {accountType === "training" && (
        <div className="muted small">Practice need: {PRACTICE_LABELS[need]}</div>
      )}
    </div>
  );
}
