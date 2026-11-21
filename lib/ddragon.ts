// Champion data from Riot's public Data Dragon CDN (allowed by Riot's policies).

export interface Champion {
  id: string; // "MonkeyKing"
  name: string; // "Wukong"
  image: string; // full URL to square icon
}

const CACHE_KEY = "uup:champions:v1";
const CACHE_MS = 6 * 60 * 60 * 1000;

let memory: Promise<Champion[]> | null = null;

export function loadChampions(): Promise<Champion[]> {
  if (!memory) {
    memory = fetchChampions().catch((err) => {
      memory = null;
      throw err;
    });
  }
  return memory;
}

async function fetchChampions(): Promise<Champion[]> {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null");
    if (cached && Date.now() - cached.at < CACHE_MS && Array.isArray(cached.list)) {
      return cached.list;
    }
  } catch {
    /* storage unavailable */
  }
  const versions: string[] = await fetch(
    "https://ddragon.leagueoflegends.com/api/versions.json",
  ).then((r) => r.json());
  const v = versions[0];
  const data = await fetch(
    `https://ddragon.leagueoflegends.com/cdn/${v}/data/en_US/champion.json`,
  ).then((r) => r.json());
  const list: Champion[] = Object.values(
    data.data as Record<string, { id: string; name: string; image: { full: string } }>,
  )
    .map((c) => ({
      id: c.id,
      name: c.name,
      image: `https://ddragon.leagueoflegends.com/cdn/${v}/img/champion/${c.image.full}`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), list }));
  } catch {
    /* ignore */
  }
  return list;
}

/** Simple fuzzy-ish search: prefix matches first, then substring. */
export function searchChampions(list: Champion[], query: string, limit = 8): Champion[] {
  const q = normalize(query);
  if (!q) return [];
  const prefix: Champion[] = [];
  const contains: Champion[] = [];
  for (const c of list) {
    const n = normalize(c.name);
    if (n.startsWith(q)) prefix.push(c);
    else if (n.includes(q) || normalize(c.id).includes(q)) contains.push(c);
  }
  return [...prefix, ...contains].slice(0, limit);
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}
