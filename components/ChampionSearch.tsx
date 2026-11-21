"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { searchChampions, type Champion } from "@/lib/ddragon";
import { Portrait } from "./Portrait";

export function ChampionSearch({
  champions,
  inPool,
  onPick,
  placeholder = "Add a champion…",
}: {
  champions: Champion[];
  inPool: Set<string>;
  onPick: (c: Champion) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const results = useMemo(() => searchChampions(champions, q), [champions, q]);

  function pick(c: Champion) {
    if (inPool.has(c.id)) return;
    onPick(c);
    setQ("");
    setActive(0);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Recompute from the live value so fast typing + Enter never uses stale results.
      const c = searchChampions(champions, e.currentTarget.value)[active];
      if (c) pick(c);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="search">
      <input
        className="input"
        placeholder={champions.length ? placeholder : "Loading champions…"}
        disabled={!champions.length}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKey}
        aria-label="Search champion"
      />
      {open && results.length > 0 && (
        <div className="search-list" role="listbox">
          {results.map((c, i) => (
            <div
              key={c.id}
              role="option"
              aria-selected={i === active}
              className={`search-item ${i === active ? "active" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              style={inPool.has(c.id) ? { opacity: 0.5, cursor: "default" } : undefined}
            >
              <Portrait champ={c} small />
              <span>{c.name}</span>
              {inPool.has(c.id) && <span className="in-pool">in pool</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
