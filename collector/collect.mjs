// UseUrPool collector: samples Master+ Ranked Solo games of one region and adds
// them to the aggregated matchup tables in Supabase. Runs in GitHub Actions.
//
// Env: RIOT_API_KEY, SUPABASE_URL, SUPABASE_SECRET_KEY, REGION (euw1|kr),
//      MAX_MINUTES (default 330), DAYS (default 3), TIMELINE_RATE (default 0.5)
// Optional (tests): RIOT_PLATFORM_BASE, RIOT_REGIONAL_BASE

import { buildItemInfo, extractDetails } from "./details.mjs";

const REGION = process.env.REGION ?? "euw1";
const MAX_MS = Number(process.env.MAX_MINUTES ?? 330) * 60_000;
const DAYS = Number(process.env.DAYS ?? 3);
// Share of games for which we also fetch the timeline (gold@3, items, skills).
const TIMELINE_RATE = Number(process.env.TIMELINE_RATE ?? 0.5);
const RIOT_KEY = need("RIOT_API_KEY");
const SB_URL = need("SUPABASE_URL").replace(/\/$/, "");
const SB_KEY = need("SUPABASE_SECRET_KEY");

const ROUTING = { euw1: "europe", eun1: "europe", tr1: "europe", kr: "asia", na1: "americas", br1: "americas" };
if (!ROUTING[REGION]) throw new Error(`Unknown REGION ${REGION}`);
const PLATFORM = process.env.RIOT_PLATFORM_BASE ?? `https://${REGION}.api.riotgames.com`;
const REGIONAL = process.env.RIOT_REGIONAL_BASE ?? `https://${ROUTING[REGION]}.api.riotgames.com`;

const POSITIONS = { TOP: "top", JUNGLE: "jungle", MIDDLE: "mid", BOTTOM: "bot", UTILITY: "support" };
const started = Date.now();
const timeLeft = () => MAX_MS - (Date.now() - started);

function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Rate limiting -------------------------------------------------------
// Personal key: 20 req / 1 s and 100 req / 2 min per routing value. The website
// shares the key, so the collector stays below that.
class Limiter {
  constructor(limits) {
    this.limits = limits; // [[count, windowMs]]
    this.stamps = [];
  }
  async take() {
    for (;;) {
      const now = Date.now();
      let wait = 0;
      for (const [count, win] of this.limits) {
        const inWin = this.stamps.filter((t) => now - t < win);
        if (inWin.length >= count) wait = Math.max(wait, win - (now - inWin[0]) + 50);
      }
      if (!wait) {
        this.stamps.push(now);
        const maxWin = Math.max(...this.limits.map((l) => l[1]));
        this.stamps = this.stamps.filter((t) => now - t < maxWin);
        return;
      }
      await sleep(wait);
    }
  }
}
const limiters = {
  platform: new Limiter([[15, 1000], [85, 120_000]]),
  regional: new Limiter([[15, 1000], [85, 120_000]]),
};

let riotCalls = 0;
async function riot(kind, path) {
  const base = kind === "platform" ? PLATFORM : REGIONAL;
  for (let attempt = 0; attempt < 5; attempt++) {
    await limiters[kind].take();
    riotCalls++;
    const res = await fetch(base + path, { headers: { "X-Riot-Token": RIOT_KEY } });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get("retry-after") ?? 5);
      console.log(`  ${res.status} on ${path.split("?")[0]}, waiting ${ra}s`);
      await sleep(ra * 1000);
      continue;
    }
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) throw new Error(`Riot API key rejected (${res.status}). Is RIOT_API_KEY current?`);
    throw new Error(`Riot ${res.status} on ${path}`);
  }
  throw new Error(`Riot keeps failing on ${path}`);
}

// ---- Supabase (PostgREST) --------------------------------------------------
async function sb(method, path, body, headers = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "content-type": "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} ${path.split("?")[0]}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// ---- Collector -------------------------------------------------------------
async function ladderPuuids() {
  const tiers = ["challengerleagues", "grandmasterleagues", "masterleagues"];
  const entries = [];
  for (const t of tiers) {
    const league = await riot("platform", `/lol/league/v4/${t}/by-queue/RANKED_SOLO_5x5`);
    for (const e of league?.entries ?? []) entries.push(e);
  }
  entries.sort((a, b) => b.leaguePoints - a.leaguePoints);
  const puuids = entries.map((e) => e.puuid).filter(Boolean);
  console.log(`Ladder ${REGION}: ${entries.length} Master+ players (${puuids.length} with puuid)`);
  return puuids;
}

const patchOf = (v) => v.split(".").slice(0, 2).join(".");
// match-v5 championName differs from Data Dragon ids in a few cases.
const FIX_NAMES = { FiddleSticks: "Fiddlesticks" };
const champ = (n) => FIX_NAMES[n] ?? n;

function toRows(m) {
  const info = m.info;
  if (info.queueId !== 420 || info.gameDuration < 300) return null;
  const parts = info.participants;
  const rows = [];
  for (const p of parts) {
    const role = POSITIONS[p.teamPosition];
    if (!role) return null; // unknown positions make lane matchups unreliable
    const opp = parts.find((o) => o.teamId !== p.teamId && o.teamPosition === p.teamPosition);
    rows.push({
      match_id: m.metadata.matchId,
      patch: patchOf(info.gameVersion),
      region: REGION,
      role,
      champion_id: champ(p.championName),
      opponent_id: opp ? champ(opp.championName) : null,
      win: p.win,
      duration_s: info.gameDuration,
    });
  }
  return rows.length === 10 ? rows : null;
}

async function knownIds(ids) {
  if (!ids.length) return new Set();
  const list = ids.map((i) => `"${i}"`).join(",");
  const rows = await sb("GET", `collected_matches?select=match_id&match_id=in.(${encodeURIComponent(list)})`);
  return new Set(rows.map((r) => r.match_id));
}

let pendingMatches = [];
let pendingRows = [];
let pendingEarly = [];
let pendingBuilds = [];
let added = 0;
let timelines = 0;
let warnedOldDb = false;
async function flush() {
  if (!pendingMatches.length) return;
  let n;
  try {
    n = await sb("POST", "rpc/add_collected_games", {
      matches: pendingMatches,
      rows: pendingRows,
      early: pendingEarly,
      builds: pendingBuilds,
    });
  } catch (e) {
    // Database not upgraded to phase 4 yet (004_matchup_details.sql): keep collecting the basics.
    if (!String(e.message).includes("PGRST202")) throw e;
    if (!warnedOldDb) console.log("Phase 4 tables missing, run supabase/004_matchup_details.sql");
    warnedOldDb = true;
    n = await sb("POST", "rpc/add_collected_games", { matches: pendingMatches, rows: pendingRows });
  }
  added += n ?? 0;
  pendingMatches = [];
  pendingRows = [];
  pendingEarly = [];
  pendingBuilds = [];
}

async function loadItemInfo() {
  const ddragon = process.env.DDRAGON_BASE ?? "https://ddragon.leagueoflegends.com";
  try {
    const versions = await fetch(`${ddragon}/api/versions.json`).then((r) => r.json());
    const items = await fetch(`${ddragon}/cdn/${versions[0]}/data/en_US/item.json`).then((r) => r.json());
    const info = buildItemInfo(items);
    console.log(`Item data ${versions[0]}: ${[...info.values()].filter((i) => i.finished).length} finished items`);
    return info;
  } catch (e) {
    console.log("Could not load item data, skipping item builds", e.message);
    return new Map();
  }
}

function saveCursor(cursor) {
  return sb("POST", "collector_state?on_conflict=region", { region: REGION, cursor, updated_at: new Date().toISOString() }, {
    Prefer: "resolution=merge-duplicates",
  });
}

async function main() {
  console.log(`Collector ${REGION}: budget ${MAX_MS / 60000} min, games from last ${DAYS} days`);
  const itemInfo = await loadItemInfo();
  const puuids = await ladderPuuids();
  if (!puuids.length) return;

  const state = await sb("GET", `collector_state?select=cursor&region=eq.${REGION}`);
  let cursor = (state[0]?.cursor ?? 0) % puuids.length;
  const seen = new Set();
  const startTime = Math.floor((Date.now() - DAYS * 86400_000) / 1000);
  let scanned = 0;

  while (timeLeft() > 60_000 && scanned < puuids.length * 3) {
    const puuid = puuids[cursor];
    cursor = (cursor + 1) % puuids.length;
    scanned++;
    const ids =
      (await riot(
        "regional",
        `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?queue=420&type=ranked&startTime=${startTime}&count=20`,
      )) ?? [];
    const fresh = ids.filter((id) => !seen.has(id));
    fresh.forEach((id) => seen.add(id));
    const known = await knownIds(fresh);
    for (const id of fresh) {
      if (known.has(id) || timeLeft() < 30_000) continue;
      const m = await riot("regional", `/lol/match/v5/matches/${encodeURIComponent(id)}`);
      const rows = m && toRows(m);
      if (!rows) continue;
      let timeline = null;
      if (Math.random() < TIMELINE_RATE) {
        timeline = await riot("regional", `/lol/match/v5/matches/${encodeURIComponent(id)}/timeline`);
        if (timeline) timelines++;
      }
      const details = extractDetails(m, timeline, rows, itemInfo);
      pendingMatches.push({ match_id: id, region: REGION, played_at: new Date(m.info.gameCreation).toISOString() });
      pendingRows.push(...rows);
      pendingEarly.push(...details.early);
      pendingBuilds.push(...details.builds);
      if (pendingMatches.length >= 25) await flush();
    }
    if (scanned % 100 === 0) await saveCursor(cursor);
    if (scanned % 25 === 0) console.log(`  ${scanned} players scanned, ${added} new games (${timelines} timelines), ${riotCalls} API calls`);
  }
  await flush();

  await saveCursor(cursor);
  const cutoff = new Date(Date.now() - 14 * 86400_000).toISOString();
  await sb("DELETE", `collected_matches?played_at=lt.${encodeURIComponent(cutoff)}`);
  await sb("POST", "rpc/prune_build_stats", { keep: 3 }).catch((e) => console.log("prune skipped:", e.message));
  console.log(`Done ${REGION}: ${scanned} players, ${added} new games, ${riotCalls} API calls, ${Math.round((Date.now() - started) / 1000)}s`);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await flush();
  } catch {}
  process.exit(1);
});
