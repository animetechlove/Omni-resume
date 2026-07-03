// ─────────────────────────────────────────────────────────────────────────────
// src/data/knownArcs.ts
// Hand-curated story-arc breakdowns for shows AniList has no arc data for
// (arcs are fan/community knowledge, not something any anime API tracks).
// Keyed by AniList ID. `startAbsolute` is the absolute episode number each
// arc begins on; the previous arc's range ends the episode before it starts.
//
// NOTE: episode boundaries below are the commonly-cited breakdown for the
// uncut Japanese numbering, entered from memory — double check the first
// couple of episodes of each arc against the actual show once seeded, and
// report back anything off so the boundaries can be corrected.
// ─────────────────────────────────────────────────────────────────────────────

export interface KnownArc {
  name: string;
  startAbsolute: number;
}

// Dragon Ball Z — AniList id 813 (291 episodes, uncut numbering)
const DRAGON_BALL_Z_ARCS: KnownArc[] = [
  { name: 'Raditz Saga',            startAbsolute: 1   },
  { name: 'Vegeta Saga',            startAbsolute: 9   },
  { name: 'Namek Saga',             startAbsolute: 36  },
  { name: 'Captain Ginyu Saga',     startAbsolute: 46  },
  { name: 'Frieza Saga',            startAbsolute: 59  },
  { name: 'Garlic Jr. Saga',        startAbsolute: 108 },
  { name: 'Trunks Saga',            startAbsolute: 118 },
  { name: 'Imperfect Cell Saga',    startAbsolute: 140 },
  { name: 'Perfect Cell Saga',      startAbsolute: 153 },
  { name: 'Cell Games Saga',        startAbsolute: 170 },
  { name: 'Other World Saga',       startAbsolute: 195 },
  { name: 'Great Saiyaman Saga',    startAbsolute: 200 },
  { name: 'World Tournament Saga',  startAbsolute: 221 },
  { name: 'Babidi Saga',            startAbsolute: 233 },
  { name: 'Majin Buu Saga',         startAbsolute: 246 },
  { name: 'Fusion Saga',            startAbsolute: 266 },
  { name: 'Kid Buu Saga',           startAbsolute: 279 },
];

export const KNOWN_ARCS: Record<number, KnownArc[]> = {
  813: DRAGON_BALL_Z_ARCS,
};
