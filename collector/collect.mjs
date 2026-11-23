// UseUrPool collector: samples Master+ Ranked Solo games of one region and adds
// them to the aggregated matchup tables in Supabase. Runs in GitHub Actions.
//
// Env: RIOT_API_KEY, SUPABASE_URL, SUPABASE_SECRET_KEY, REGION (euw1|kr),
//      MAX_MINUTES (default 330), DAYS (default 3), TIMELINE_RATE (default 0.3)
// Optional (tests): RIOT_PLATFORM_BASE, RIOT_REGIONAL_BASE

import { buildItemInfo, extractDetails } from "./details.mjs";

const REGION = process.env.REGION ?? "euw1";
const MAX_MS = Number(process.env.MAX_MINUTES ?? 330) * 60_000;
const DAYS = Number(process.env.DAYS ?? 3);
// Share of games for which we also fetch the timeline (gold@3, items, skills).
const TIMELINE_RATE = Number(process.env.TIMELINE_RATE ?? 0.3);
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
  platform: new Limiter([[15, 1000], [92, 120_000]]),
  regional: new Limiter([[15, 1000], [92, 120_000]]),
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
let pendingOtp = [];
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
      otp: pendingOtp,
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
  pendingOtp = [];
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

// ---- One-tricks ------------------------------------------------------------
// A ladder player is a one-trick (OTP) when their most played champion has at
// least 3x the mastery points of the second one (and 300k+ points).
// Mastery uses the platform host, so these calls don't slow down match fetching.
const otpChamp = new Map(); // puuid -> champion id (only OTPs)
const checkedAt = new Map(); // puuid -> ms
let champByKey = new Map();

async function loadChampKeys() {
  const ddragon = process.env.DDRAGON_BASE ?? "https://ddragon.leagueoflegends.com";
  try {
    const versions = await fetch(`${ddragon}/api/versions.json`).then((r) => r.json());
    const data = await fetch(`${ddragon}/cdn/${versions[0]}/data/en_US/champion.json`).then((r) => r.json());
    champByKey = new Map(Object.values(data.data).map((c) => [Number(c.key), c.id]));
  } catch (e) {
    console.log("Could not load champion keys, skipping OTP detection", e.message);
  }
}

async function loadOtpPlayers() {
  for (let offset = 0; ; offset += 1000) {
    let rows;
    try {
      rows = await sb("GET", `otp_players?select=puuid,champion_id,is_otp,checked_at&region=eq.${REGION}&order=puuid&limit=1000&offset=${offset}`);
    } catch (e) {
      console.log("OTP table missing (run supabase/005_pro_otp.sql), skipping OTPs");
      return false;
    }
    for (const r of rows) {
      checkedAt.set(r.puuid, Date.parse(r.checked_at));
      if (r.is_otp && r.champion_id) otpChamp.set(r.puuid, r.champion_id);
    }
    if (rows.length < 1000) break;
  }
  console.log(`OTPs known in ${REGION}: ${otpChamp.size} (${checkedAt.size} players checked)`);
  return true;
}

/** Background loop: refresh mastery of ladder players not checked in 7 days. */
async function refreshOtps(puuids, stop) {
  if (!champByKey.size) return;
  const stale = puuids.filter((p) => !checkedAt.has(p) || Date.now() - checkedAt.get(p) > 7 * 86400_000);
  let n = 0;
  let batch = [];
  for (const puuid of stale) {
    if (stop.done || timeLeft() < 90_000) break;
    const top = await riot("platform", `/lol/champion-mastery/v4/champion-masteries/by-puuid/${encodeURIComponent(puuid)}/top?count=2`);
    if (!top) continue;
    const first = top[0]?.championPoints ?? 0;
    const second = top[1]?.championPoints ?? 0;
    const champion_id = champByKey.get(top[0]?.championId) ?? null;
    const is_otp = Boolean(champion_id) && first >= 300_000 && first >= 3 * Math.max(second, 1);
    if (is_otp) otpChamp.set(puuid, champion_id);
    else otpChamp.delete(puuid);
    checkedAt.set(puuid, Date.now());
    batch.push({ puuid, region: REGION, champion_id, top_points: first, second_points: second, is_otp, checked_at: new Date().toISOString() });
    n++;
    if (batch.length >= 50) {
      await sb("POST", "otp_players?on_conflict=puuid", batch, { Prefer: "resolution=merge-duplicates" });
      batch = [];
    }
  }
  if (batch.length) await sb("POST", "otp_players?on_conflict=puuid", batch, { Prefer: "resolution=merge-duplicates" });
  console.log(`Mastery checked for ${n} players, ${otpChamp.size} OTPs known`);
}

function saveCursor(cursor) {
  return sb("POST", "collector_state?on_conflict=region", { region: REGION, cursor, updated_at: new Date().toISOString() }, {
    Prefer: "resolution=merge-duplicates",
  });
}

async function main() {
  console.log(`Collector ${REGION}: budget ${MAX_MS / 60000} min, games from last ${DAYS} days`);
  const itemInfo = await loadItemInfo();
  await loadChampKeys();
  const otpEnabled = await loadOtpPlayers();
  const puuids = await ladderPuuids();
  if (!puuids.length) return;
  const stopOtp = { done: false };
  const otpTask = otpEnabled
    ? refreshOtps(puuids, stopOtp).catch((e) => console.log("OTP refresh failed:", e.message))
    : Promise.resolve();

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
      m.info.participants.forEach((p, i) => {
        if (otpChamp.get(p.puuid) === rows[i].champion_id) pendingOtp.push(rows[i]);
      });
      if (pendingMatches.length >= 25) await flush();
    }
    if (scanned % 100 === 0) await saveCursor(cursor);
    if (scanned % 25 === 0) console.log(`  ${scanned} players scanned, ${added} new games (${timelines} timelines), ${riotCalls} API calls`);
  }
  await flush();
  stopOtp.done = true;
  await otpTask;

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
