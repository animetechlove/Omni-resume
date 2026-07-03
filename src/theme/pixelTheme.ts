// ─────────────────────────────────────────────────────────────────────────────
// src/theme/pixelTheme.ts
// All design tokens for the Omni-Resume pixel / JRPG aesthetic.
// Every component derives colors and type from here — no hard-coded values.
// ─────────────────────────────────────────────────────────────────────────────

export const Colors = {
  // Base surfaces
  void:       '#0B0E1A',   // page background
  panel:      '#1B2340',   // panel / dialog background
  panelDeep:  '#121833',   // inner panel / episode tiles
  // Borders (two-tone bevel = classic SNES chrome)
  borderLo:   '#0A0E1F',   // shadow / bottom-right bevel
  borderHi:   '#5C6FB0',   // highlight / top-left bevel
  borderMid:  '#4A5A8C',   // standard border
  // Accent
  gold:       '#FFC93C',   // primary accent, cursor color, panel label bg
  coral:      '#FF6B6B',   // alert / paused / important action
  mint:       '#6BFFB8',   // success / streaming / watched
  violet:     '#C084FC',   // play mode
  blue:       '#60A5FA',   // migrated / info
  // Text
  cream:      '#F4EFE0',   // primary text
  dim:        '#8C95C2',   // secondary / hint text
} as const;

export const Fonts = {
  // Press Start 2P — chunky bitmap, titles / buttons / panel labels
  display: 'PressStart2P_400Regular',
  // VT323 — legible pixel monospace, body / episode labels / data
  body:    'VT323_400Regular',
} as const;

export const FontSizes = {
  // Display (Press Start 2P) — use sparingly; every size costs width
  displayLg:  24,
  displayMd:  14,
  displaySm:  11,
  displayXs:  9,
  // Body (VT323)
  bodyXl:     28,
  bodyLg:     22,
  bodyMd:     18,
  bodySm:     16,
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 18,
  xl: 24,
  xxl: 32,
} as const;

/** Two-tone bevel shadow — the single most recognizable SNES chrome tell. */
export const panelShadow = {
  shadowColor: Colors.borderLo,
  shadowOffset: { width: 4, height: 4 },
  shadowOpacity: 1,
  shadowRadius: 0,
  elevation: 4,
} as const;

/** Inset highlight bevel (top-left) — applied as a borderTop/borderLeft trick on iOS. */
export function bevelBorder(width: number = 3): Record<string, number | string> {
  return {
    borderWidth: width,
    borderTopColor: Colors.borderHi,
    borderLeftColor: Colors.borderHi,
    borderBottomColor: Colors.borderMid,
    borderRightColor: Colors.borderMid,
    borderRadius: 0, // NO border-radius anywhere — the defining rule of the pixel aesthetic
  };
}

/** Panel label chip — the gold bar above each panel. */
export const panelLabelStyle = {
  fontFamily: Fonts.display,
  fontSize: FontSizes.displayXs,
  color: Colors.void,
  backgroundColor: Colors.gold,
  paddingHorizontal: Spacing.sm,
  paddingVertical: 4,
  letterSpacing: 1,
  borderRadius: 0,
} as const;

/** State pill colors by watch_status. */
export const StatusColors: Record<string, { bg: string; text: string; label: string }> = {
  DISCOVERED:  { bg: Colors.dim,     text: Colors.void, label: '◌ NOT STARTED'     },
  STREAMING:   { bg: Colors.mint,    text: Colors.void, label: '▶ STREAMING NOW'    },
  PAUSED:      { bg: Colors.coral,   text: Colors.void, label: '⏸ PAUSED'           },
  MIGRATED:    { bg: Colors.blue,    text: Colors.void, label: '⇄ MOVED'            },
  UNAVAILABLE: { bg: Colors.dim,     text: Colors.void, label: '⦸ UNAVAILABLE'      },
  COMPLETED:   { bg: Colors.mint,    text: Colors.void, label: '✓ COMPLETED'        },
  DROPPED:     { bg: Colors.borderMid,text:Colors.cream, label: '✗ DROPPED'         },
};

export const PlayStatusColors: Record<string, { bg: string; text: string; label: string }> = {
  NONE:       { bg: Colors.dim,    text: Colors.void,  label: '▢ NOT STARTED' },
  PLAYING:    { bg: Colors.violet, text: Colors.void,  label: '▶ PLAYING'     },
  PAUSED:     { bg: Colors.coral,  text: Colors.void,  label: '⏸ PAUSED'      },
  COMPLETED:  { bg: Colors.mint,   text: Colors.void,  label: '✓ DONE'        },
};

/** Episode tile states for the quest log grid. */
export const EpisodeTileState = {
  watched: {
    borderColor: Colors.mint,
    color: Colors.mint,
    mark: '✓',
  },
  current: {
    borderColor: Colors.gold,
    color: Colors.gold,
    mark: '◉',
  },
  upcoming: {
    borderColor: Colors.borderMid,
    color: Colors.borderMid,
    mark: '▢',
  },
  ova: {
    borderColor: Colors.violet,
    color: Colors.violet,
    mark: '★',
  },
} as const;
