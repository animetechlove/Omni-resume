// ─────────────────────────────────────────────────────────────────────────────
// src/data/knownArcs.ts
// Hand-curated story-arc breakdowns for shows AniList has no arc data for
// (arcs are fan/community knowledge, not something any anime API tracks).
// Keyed by AniList ID. `startAbsolute` is the absolute episode number each
// arc begins on; the previous arc's range ends the episode before it starts.
//
// NOTE: Dragon Ball Z's boundaries are the commonly-cited breakdown for the
// uncut Japanese numbering, entered from memory — double check the first
// couple of episodes of each arc against the actual show once seeded, and
// report back anything off so the boundaries can be corrected.
//
// Every other show below (One Piece, Naruto, Naruto: Shippuden, Bleach) is
// sourced from live web searches — fan wikis, Wikipedia episode lists, and
// filler-guide sites — cross-referenced across multiple results, not
// entered from memory. Still not a single authoritative table though, and
// low-profile connective/filler arcs were sometimes folded into a
// neighboring arc rather than guessed at exactly. Verify against the first
// episode of each arc once seeded, and report back anything off.
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

// One Piece — AniList id 21 (ongoing; 1168+ episodes as of source searches)
const ONE_PIECE_ARCS: KnownArc[] = [
  { name: 'East Blue Saga',          startAbsolute: 1    },
  { name: 'Alabasta Saga',           startAbsolute: 62   },
  { name: 'Skypiea Saga',            startAbsolute: 144  },
  { name: 'Davy Back Fight',         startAbsolute: 207  },
  { name: 'Water 7 Saga',            startAbsolute: 229  },
  { name: 'Enies Lobby Saga',        startAbsolute: 264  },
  { name: 'Thriller Bark Saga',      startAbsolute: 337  },
  { name: 'Sabaody Archipelago Arc', startAbsolute: 385  },
  { name: 'Amazon Lily Arc',         startAbsolute: 408  },
  { name: 'Impel Down Arc',          startAbsolute: 422  },
  { name: 'Marineford Arc',          startAbsolute: 457  },
  { name: 'Post-War Arc',            startAbsolute: 490  },
  { name: 'Fishman Island Saga',     startAbsolute: 523  },
  { name: 'Punk Hazard Arc',         startAbsolute: 579  },
  { name: 'Dressrosa Arc',           startAbsolute: 629  },
  { name: 'Zou Arc',                 startAbsolute: 751  },
  { name: 'Whole Cake Island Arc',   startAbsolute: 783  },
  { name: 'Wano Country Arc',        startAbsolute: 890  },
  { name: 'Egghead Arc',             startAbsolute: 1089 },
];

// Naruto — AniList id 20 (220 episodes)
const NARUTO_ARCS: KnownArc[] = [
  { name: 'Land of Waves',                      startAbsolute: 1   },
  { name: 'Chunin Exams',                       startAbsolute: 20  },
  { name: 'Konoha Crush',                       startAbsolute: 68  },
  { name: 'Search for Tsunade',                 startAbsolute: 81  },
  { name: 'Land of Tea Escort Mission',         startAbsolute: 102 },
  { name: 'Sasuke Recovery Mission',            startAbsolute: 107 },
  { name: 'Land of Rice Fields Investigation',  startAbsolute: 136 },
  { name: 'Mission of the Week (Filler)',       startAbsolute: 142 },
  { name: 'Sunagakure Support Mission',         startAbsolute: 216 },
];

// Naruto: Shippuden — AniList id 1735 (500 episodes)
const NARUTO_SHIPPUDEN_ARCS: KnownArc[] = [
  { name: 'Kazekage Rescue Mission',            startAbsolute: 1   },
  { name: 'Sasuke and Sai',                     startAbsolute: 33  },
  { name: 'Twelve Guardian Ninja',              startAbsolute: 54  },
  { name: 'Hidan and Kakuzu',                   startAbsolute: 72  },
  { name: 'Three-Tails Appearance',             startAbsolute: 89  },
  { name: 'Itachi Pursuit',                     startAbsolute: 113 },
  { name: 'Tale of Jiraiya the Gallant',        startAbsolute: 127 },
  { name: 'Fated Battle Between Brothers',      startAbsolute: 134 },
  { name: 'Six-Tails Unleashed',                startAbsolute: 144 },
  { name: "Pain's Assault",                     startAbsolute: 152 },
  { name: 'Fifth Kage Summit',                  startAbsolute: 197 },
  { name: 'Fourth Shinobi War: Countdown',      startAbsolute: 215 },
  { name: 'Fourth Shinobi War: Confrontation',  startAbsolute: 261 },
  { name: 'Fourth Shinobi War: Climax',         startAbsolute: 322 },
  { name: "Birth of the Ten-Tails' Jinchuuriki",startAbsolute: 378 },
  { name: 'Kaguya Otsutsuki Strikes',           startAbsolute: 451 },
  { name: 'Sasuke Shinden',                     startAbsolute: 484 },
  { name: 'Shikamaru Hiden',                    startAbsolute: 489 },
  { name: 'Konoha Hiden',                       startAbsolute: 494 },
];

// Bleach — AniList id 269 (366 episodes, original run before Thousand-Year
// Blood War, which is separate AniList entries and not included here)
const BLEACH_ARCS: KnownArc[] = [
  { name: 'The Substitute',                     startAbsolute: 1   },
  { name: 'Soul Society Sneak Entry',           startAbsolute: 21  },
  { name: 'Soul Society Rescue',                startAbsolute: 42  },
  { name: 'Bount',                              startAbsolute: 64  },
  { name: 'Bount Assault on Soul Society',      startAbsolute: 92  },
  { name: 'Arrancar: The Arrival',              startAbsolute: 110 },
  { name: 'Arrancar: Hueco Mundo Sneak Entry',  startAbsolute: 132 },
  { name: 'Arrancar: The Fierce Fight',         startAbsolute: 152 },
  { name: 'New Captain Shusuke Amagai',         startAbsolute: 168 },
  { name: 'Arrancar vs. Shinigami',             startAbsolute: 190 },
  { name: 'Arrancar: Decisive Battle of Karakura', startAbsolute: 213 },
  { name: 'Zanpakuto: The Alternate Tale',      startAbsolute: 230 },
  { name: 'Arrancar: Downfall',                 startAbsolute: 266 },
  { name: 'Gotei 13: Invading Army',            startAbsolute: 317 },
  { name: 'Fullbring',                          startAbsolute: 343 },
];

export const KNOWN_ARCS: Record<number, KnownArc[]> = {
  813:  DRAGON_BALL_Z_ARCS,
  21:   ONE_PIECE_ARCS,
  20:   NARUTO_ARCS,
  1735: NARUTO_SHIPPUDEN_ARCS,
  269:  BLEACH_ARCS,
};
