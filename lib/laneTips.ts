// Hand-written starting points for the matchups that cause the most trouble.
// These are DRAFTS: general principles, not patch-exact numbers. The player's own
// notes (shown above) always win. Keys use Data Dragon ids.

/** Tips that apply whoever you play into this enemy. */
export const ENEMY_TIPS: Record<string, string[]> = {
  Darius: [
    "Never stand at the edge of his Q (blade): either step inside it or stay fully out of range.",
    "Every fight he wins comes from stacking his passive. Keep trades short and leave before 3–4 stacks.",
    "His E (pull) is the threat. Play aggressive only in the window right after he used it.",
    "He has no dash: keep the wave near your tower and play for jungle ganks.",
  ],
  Renekton: [
    "Watch his fury bar. At 50+ fury his W stun and Q are empowered: back off then.",
    "His strongest moment is level 3 with full fury (E in, W stun, Q, E out). Respect it.",
    "Trade when his fury is low or right after he used E out. He falls off if the lane is even.",
  ],
  Fiora: [
    "Don't throw your hard CC or key ability into her W (Riposte): bait it first, then commit.",
    "She heals and wins by hitting vitals: rotate away from the vital side when you can.",
    "Short trades only. Long fights with her R up are her best case.",
  ],
};

/** Extra lines for specific pairings (your champion vs enemy). */
export const PAIR_TIPS: Record<string, string[]> = {
  "Ornn|Darius": [
    "Weak early: farm safely and scale. Your teamfight (R + E into wall) is worth more than winning lane.",
    "Trade back with Q into W only after his E pull is used.",
  ],
  "Gnar|Darius": [
    "Mini Gnar: kite with range and W stacks, never let him close the gap.",
    "Plan Mega Gnar near walls so W/R stun him. Don't transform in the open next to him.",
  ],
  "Camille|Darius": [
    "Use E (Hookshot) to engage after his pull is on cooldown, then leave before passive stacks build.",
    "Q-auto-Q short trades are fine; extended fights inside his blade are not.",
  ],
  "Jax|Darius": [
    "Use your E (Counter Strike) to start trades, but be ready to jump out with Q before 5 stacks.",
  ],
  "Chogath|Darius": [
    "Play at range: Q to zone him off the wave, eat minions with your passive to sustain.",
  ],
  "Ornn|Renekton": [
    "Give up some CS before level 6 if he has fury. Your scaling and teamfight carry the game.",
  ],
  "Gnar|Renekton": [
    "Mini Gnar outranges him: poke with Q/autos when his fury is low, stay away when it's high.",
  ],
  "Camille|Renekton": [
    "Don't E into him when he has 50 fury; wait for his empowered W to be used.",
  ],
  "Jax|Renekton": [
    "Save E (Counter Strike) for his engage; it blocks his auto damage during the dive.",
  ],
  "Ornn|Fiora": [
    "Your W and Q are easy to Riposte; hit with autos and brittle, save the stun for after her W.",
  ],
  "Camille|Fiora": [
    "Her W blocks your E stun: bait it with Q, then Hookshot.",
  ],
  "Gnar|Fiora": [
    "Mini Gnar can poke her freely; Mega Gnar W/R into Riposte is a disaster. Bait it first.",
  ],
  "Jax|Fiora": [
    "Your E stun and her W both counter each other: whoever waits longer usually wins.",
  ],
};

export function draftTips(champ: string, enemy: string): string[] {
  return [...(PAIR_TIPS[`${champ}|${enemy}`] ?? []), ...(ENEMY_TIPS[enemy] ?? [])];
}
