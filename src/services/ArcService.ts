// ─────────────────────────────────────────────────────────────────────────────
// src/services/ArcService.ts
// Seeds hand-curated story-arc data (src/data/knownArcs.ts) for shows AniList
// has no arc information for, and assigns each episode to the arc whose
// range contains it.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuidv4 } from 'uuid';
import { KNOWN_ARCS } from '../data/knownArcs';
import {
  upsertArc, getArcsForTitle, getEpisodesForTitle, upsertEpisode,
} from '../db/dao/TitleDAO';

/**
 * If `anilistId` matches a known franchise in knownArcs.ts, creates its arc
 * rows for `titleId` and assigns every existing episode to the arc whose
 * range contains its absolute_number. Returns true if arcs were seeded.
 */
export async function seedKnownArcs(titleId: string, anilistId: number): Promise<boolean> {
  const knownArcs = KNOWN_ARCS[anilistId];
  if (!knownArcs || knownArcs.length === 0) return false;

  for (let i = 0; i < knownArcs.length; i++) {
    const arc = knownArcs[i];
    await upsertArc({
      arc_id: uuidv4(),
      title_id: titleId,
      arc_index: i,
      name: arc.name,
      starts_at_abs: arc.startAbsolute,
    });
  }

  await assignEpisodesToArcs(titleId);
  return true;
}

/**
 * (Re)assigns every episode of `titleId` to whichever existing arc's range
 * contains it. Safe to call repeatedly — in particular, needed after
 * backfilling episode rows that didn't exist yet the first time arcs were
 * seeded (they'd otherwise sit with arc_id null forever).
 */
export async function assignEpisodesToArcs(titleId: string): Promise<void> {
  // Re-read back so we have the real arc_ids (upsertArc generates a fresh
  // uuid each call, but ON CONFLICT keeps the original row's id).
  const savedArcs = await getArcsForTitle(titleId);
  if (savedArcs.length === 0) return;
  const episodes = await getEpisodesForTitle(titleId);

  for (const ep of episodes) {
    let matched = null;
    for (let i = savedArcs.length - 1; i >= 0; i--) {
      if (ep.absolute_number >= savedArcs[i].starts_at_abs) {
        matched = savedArcs[i];
        break;
      }
    }
    if (matched && ep.arc_id !== matched.arc_id) {
      await upsertEpisode({ ...ep, arc_id: matched.arc_id });
    }
  }
}
