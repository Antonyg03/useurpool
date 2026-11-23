import type { AccountType, PoolEntry, Role } from "./types";

// Starter pools so the owner doesn't have to click everything in by hand.
// Matched against Data Dragon by champion *name*; unknown names are skipped.
type Preset = Omit<PoolEntry, "championId" | "sortOrder"> & { name: string };

const MAIN_TOP: Preset[] = [
  { name: "Ornn", tier: "S", situational: false, practiceNeed: null, note: "", role: "top" },
  { name: "Camille", tier: "A", situational: false, practiceNeed: null, note: "", role: "top" },
  { name: "Gnar", tier: "A", situational: false, practiceNeed: null, note: "Usual pick vs Darius.", role: "top" },
  { name: "Cho'Gath", tier: "B", situational: true, practiceNeed: null, note: "", role: "top" },
  { name: "Jax", tier: "B", situational: true, practiceNeed: null, note: "A-tier vs Camille, otherwise B.", role: "top" },
  { name: "Zaahen", tier: "B", situational: true, practiceNeed: null, note: "Very good vs Camille.", role: "top" },
  { name: "Ambessa", tier: "B", situational: false, practiceNeed: null, note: "", role: "top" },
];

const TRAINING_TOP: Preset[] = [
  { name: "Gwen", tier: "C", situational: false, practiceNeed: "high", note: "", role: "top" },
  { name: "Kennen", tier: "C", situational: false, practiceNeed: "medium", note: "", role: "top" },
  { name: "Jax", tier: "B", situational: false, practiceNeed: "some", note: "", role: "top" },
  { name: "Zaahen", tier: "B", situational: false, practiceNeed: "some", note: "", role: "top" },
  { name: "Camille", tier: "A", situational: false, practiceNeed: "almost_done", note: "", role: "top" },
  { name: "Gnar", tier: "A", situational: false, practiceNeed: "almost_done", note: "", role: "top" },
];

// Mid: no comfort tiers given yet, so everything starts at B (adjust on the page).
const MAIN_MID: Preset[] = ["Diana", "Annie", "Viktor", "Orianna", "Syndra"].map((name) => ({
  name,
  tier: "B",
  situational: false,
  practiceNeed: null,
  note: "",
  role: "mid",
}));

/** Roles that have a suggested pool (only for the main account where noted). */
export function hasPreset(type: AccountType, role: Role): boolean {
  return presetFor(type, role).length > 0;
}

export function presetFor(type: AccountType, role: Role): Preset[] {
  if (role === "top") return type === "main" ? MAIN_TOP : TRAINING_TOP;
  if (role === "mid") return type === "main" ? MAIN_MID : [];
  return [];
}
