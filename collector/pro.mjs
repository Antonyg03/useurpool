// UseUrPool pro importer: pro games (LCK, LPL, LEC, LCS/LTA North + international
// events) from Leaguepedia's public Cargo API into Supabase table pro_games.
// Runs daily in GitHub Actions.
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY, DAYS (default 220), DRY_RUN=1 (only log)

const DAYS = Number(process.env.DAYS ?? 220);
const DRY = process.env.DRY_RUN === "1";
const SB_URL = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const SB_KEY = process.env.SUPABASE_SECRET_KEY ?? "";
if (!DRY && (!SB_URL || !SB_KEY)) throw new Error("Missing SUPABASE_URL / SUPABASE_SECRET_KEY");

const API = process.env.LEAGUEPEDIA_API ?? "https://lol.fandom.com/api.php";
const UA = "UseUrPool-pro-importer/1.0 (personal, non-commercial)";
const LEAGUES = ["LCK", "LPL", "LEC", "LCS", "LTA North", "MSI", "Worlds", "First Stand"];
const ROLES = { Top: "top", Jungle: "jungle", Mid: "mid", Bot: "bot", Support: "support" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cargo(params) {
  const qs = new URLSearchParams({ action: "cargoquery", format: "json", ...params });
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(`${API}?${qs}`, { headers: { "User-Agent": UA } });
    const json = await res.json().catch(() => null);
    if (res.ok && json && !json.error) return (json.cargoquery ?? []).map((r) => r.title);
    const msg = json?.error?.info ?? `HTTP ${res.status}`;
    console.log(`  Leaguepedia: ${msg}, retrying`);
    await sleep(5000 * (attempt + 1));
  }
  throw new Error("Leaguepedia keeps failing");
}

async function champMap() {
  const versions = await fetch("https://ddragon.leagueoflegends.com/api/versions.json").then((r) => r.json());
  const data = await fetch(
    `https://ddragon.leagueoflegends.com/cdn/${versions[0]}/data/en_US/champion.json`,
  ).then((r) => r.json());
  const m = new Map();
  for (const c of Object.values(data.data)) {
    m.set(norm(c.name), c.id);
    m.set(norm(c.id), c.id);
  }
  m.set(norm("Nunu"), "Nunu");
  return m;
}
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");

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

async function main() {
  const champs = await champMap();
  const since = new Date(Date.now() - DAYS * 86400_000).toISOString().slice(0, 10);
  const leagueWhere = LEAGUES.map((l) => `SG.OverviewPage LIKE '${l}/%'`).join(" OR ");
  const where = `SG.DateTime_UTC >= '${since}' AND (${leagueWhere})`;
  console.log(`Fetching pro games since ${since}`);

  const raw = [];
  for (let offset = 0; ; offset += 500) {
    const rows = await cargo({
      tables: "ScoreboardGames=SG,ScoreboardPlayers=SP",
      join_on: "SG.GameId=SP.GameId",
      fields: "SG.GameId=GameId,SG.DateTime_UTC=Date,SG.Patch=Patch,SG.OverviewPage=Page,SP.Champion=Champion,SP.Role=Role,SP.PlayerWin=Win,SP.Side=Side",
      where,
      order_by: "SG.DateTime_UTC DESC",
      limit: "500",
      offset: String(offset),
    });
    raw.push(...rows);
    console.log(`  ${raw.length} player rows`);
    if (rows.length < 500) break;
    await sleep(1500);
  }

  // Group per game + role to find lane opponents.
  const games = new Map();
  const unknown = new Set();
  for (const r of raw) {
    const role = ROLES[r.Role];
    const champion = champs.get(norm(r.Champion));
    if (!role || !r.GameId || !r.Patch) continue;
    if (!champion) {
      unknown.add(r.Champion);
      continue;
    }
    const key = `${r.GameId}|${role}`;
    if (!games.has(key)) games.set(key, []);
    games.get(key).push({
      game_id: r.GameId,
      role,
      champion_id: champion,
      league: String(r.Page).split("/")[0],
      patch: String(r.Patch),
      game_date: new Date(`${r.Date.replace(" ", "T")}Z`).toISOString(),
      win: r.Win === "Yes" || r.Win === "1",
    });
  }
  const out = [];
  for (const pair of games.values()) {
    if (pair.length !== 2) continue;
    out.push({ ...pair[0], opponent_id: pair[1].champion_id }, { ...pair[1], opponent_id: pair[0].champion_id });
  }
  if (unknown.size) console.log("Unknown champion names:", [...unknown].join(", "));
  const patches = [...new Set(out.map((r) => r.patch))];
  const leagues = [...new Set(out.map((r) => r.league))];
  console.log(`${out.length / 2} lane matchups, patches: ${patches.join(", ")}, leagues: ${leagues.join(", ")}`);
  if (DRY) {
    console.log("Sample:", JSON.stringify(out.slice(0, 4)));
    return;
  }

  for (let i = 0; i < out.length; i += 1000) {
    await sb("POST", "pro_games?on_conflict=game_id,role,champion_id", out.slice(i, i + 1000), {
      Prefer: "resolution=merge-duplicates",
    });
  }
  const cutoff = new Date(Date.now() - (DAYS + 60) * 86400_000).toISOString();
  await sb("DELETE", `pro_games?game_date=lt.${encodeURIComponent(cutoff)}`);
  console.log(`Saved ${out.length} rows`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
