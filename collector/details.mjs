// Extracts early-game and build information from a match (+ optional timeline).
// Pure functions, so they can be tested without the Riot API.

const SKILLS = { 1: "Q", 2: "W", 3: "E", 4: "R" };

/**
 * itemInfo: Map<itemId:number, { finished: boolean }>  (from Data Dragon item.json)
 * Returns { early: [...], builds: [...] } rows for add_collected_games.
 * `base` holds the lane rows from toRows (one per participant, same order as participants).
 */
export function extractDetails(match, timeline, base, itemInfo) {
  const parts = match.info.participants;
  const builds = [];
  const early = [];

  const byPid = new Map(parts.map((p, i) => [p.participantId ?? i + 1, i]));
  const purchases = new Map(); // pid -> [{itemId, t}]
  const skillUps = new Map(); // pid -> ["Q","W",...]
  const firstLaneKill = new Map(); // "pidA-pidB" sorted -> killerPid
  let frame3 = null;

  if (timeline) {
    const frames = timeline.info?.frames ?? [];
    frame3 = frames.find((f) => f.timestamp >= 180_000 && f.timestamp < 240_000) ?? frames[3] ?? null;
    for (const f of frames) {
      for (const ev of f.events ?? []) {
        if (ev.type === "ITEM_PURCHASED") {
          push(purchases, ev.participantId, { itemId: ev.itemId, t: ev.timestamp });
        } else if (ev.type === "ITEM_UNDO") {
          const list = purchases.get(ev.participantId);
          if (list && ev.beforeId) {
            for (let i = list.length - 1; i >= 0; i--) {
              if (list[i].itemId === ev.beforeId) {
                list.splice(i, 1);
                break;
              }
            }
          }
        } else if (ev.type === "SKILL_LEVEL_UP" && ev.levelUpType !== "EVOLVE") {
          const s = SKILLS[ev.skillSlot];
          if (s) push(skillUps, ev.participantId, s);
        } else if (ev.type === "CHAMPION_KILL" && ev.timestamp < 240_000 && ev.killerId && ev.victimId) {
          const key = pairKey(ev.killerId, ev.victimId);
          if (!firstLaneKill.has(key)) firstLaneKill.set(key, ev.killerId);
        }
      }
    }
  }

  parts.forEach((p, i) => {
    const row = base[i];
    if (!row || !row.opponent_id) return;
    const pid = p.participantId ?? i + 1;
    const opp = parts.find((o) => o.teamId !== p.teamId && o.teamPosition === p.teamPosition);
    const oppPid = opp ? (opp.participantId ?? parts.indexOf(opp) + 1) : null;
    const common = {
      match_id: row.match_id,
      patch: row.patch,
      role: row.role,
      champion_id: row.champion_id,
      opponent_id: row.opponent_id,
      win: row.win,
    };

    // Runes come with every match.
    const styles = p.perks?.styles ?? [];
    const keystone = styles[0]?.selections?.[0]?.perk;
    const secondary = styles[1]?.style;
    if (keystone) {
      builds.push({ ...common, kind: "keystone", value: String(keystone) });
      if (secondary) builds.push({ ...common, kind: "runes", value: `${keystone}:${secondary}` });
    }

    if (!timeline) return;

    // Early game vs lane opponent.
    if (frame3 && oppPid) {
      const me = frame3.participantFrames?.[String(pid)];
      const them = frame3.participantFrames?.[String(oppPid)];
      if (me && them) {
        const killer = firstLaneKill.get(pairKey(pid, oppPid));
        early.push({
          ...common,
          region: row.region,
          gold3_diff: Math.round((me.totalGold ?? 0) - (them.totalGold ?? 0)),
          xp3_diff: Math.round((me.xp ?? 0) - (them.xp ?? 0)),
          fb_for: killer === pid,
          fb_against: killer === oppPid,
        });
      }
    }

    // Items.
    const bought = purchases.get(pid) ?? [];
    const start = bought
      .filter((b) => b.t < 60_000)
      .map((b) => b.itemId)
      .sort((a, b) => a - b);
    if (start.length) builds.push({ ...common, kind: "start", value: start.join("+") });
    const finished = [];
    for (const b of bought) {
      if (itemInfo.get(b.itemId)?.finished && !finished.includes(b.itemId)) finished.push(b.itemId);
      if (finished.length === 2) break;
    }
    if (finished.length === 2) builds.push({ ...common, kind: "items", value: finished.join(">") });

    // Skills.
    const ups = skillUps.get(pid) ?? [];
    if (ups.length >= 3) builds.push({ ...common, kind: "skill_start", value: ups.slice(0, 3).join("") });
    const max = skillMaxOrder(ups);
    if (max) builds.push({ ...common, kind: "skill_max", value: max });
  });

  return { early, builds };
}

/** Order in which Q/W/E reach 5 points, e.g. "Q>E>W". Needs enough level-ups. */
export function skillMaxOrder(ups) {
  const pts = { Q: 0, W: 0, E: 0 };
  const order = [];
  for (const s of ups) {
    if (!(s in pts)) continue;
    pts[s]++;
    if (pts[s] === 5) order.push(s);
  }
  if (order.length >= 1) {
    // Fill the rest by points (most points first) once the first skill is maxed.
    const rest = ["Q", "W", "E"].filter((s) => !order.includes(s)).sort((a, b) => pts[b] - pts[a]);
    if (order.length === 1 && rest.length === 2 && pts[rest[0]] === pts[rest[1]]) return null;
    return [...order, ...rest].join(">");
  }
  return null;
}

/** Finished items: completed items on Summoner's Rift that build into nothing (no boots). */
export function buildItemInfo(itemJson) {
  const out = new Map();
  for (const [id, it] of Object.entries(itemJson.data ?? {})) {
    const tags = it.tags ?? [];
    const finished =
      (it.gold?.total ?? 0) >= 2200 &&
      it.gold?.purchasable !== false &&
      !(it.into?.length) &&
      it.maps?.["11"] !== false &&
      !tags.includes("Boots") &&
      !tags.includes("Consumable") &&
      !tags.includes("Trinket");
    out.set(Number(id), { finished });
  }
  return out;
}

function push(map, key, v) {
  const list = map.get(key);
  if (list) list.push(v);
  else map.set(key, [v]);
}

function pairKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}
