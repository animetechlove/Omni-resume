// ─────────────────────────────────────────────────────────────────────────────
// src/services/ImportService.ts
// §13.1 — AniList / MAL import with the never-regress merge rule.
// Pull-only by default. Explicit opt-in "push to AniList" is separate.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuidv4 } from 'uuid';
import type {
  ImportedListEntry, ExternalListStatus, WatchStatus, Progress,
} from '../types';
import { getTitleByAnilistId, upsertTitle, getEpisodesForTitle } from '../db/dao/TitleDAO';
import { getProgress, getOrCreateProgress, recordWatchProgress } from '../db/dao/ProgressDAO';
import { fetchUserList, fetchViewer, fetchTitleMetadata } from './AniListClient';
import { execute, query, transaction } from '../db/database';

// Corrupt-data guard only — real shows never get near this (One Piece is
// ~1100 and counting).
const MAX_STUBBED_EPISODES = 3000;

// ─── STATUS MAPPING ──────────────────────────────────────────────────────────

/** §13.1 mapping table: external list status → internal WatchStatus. */
function mapExternalStatus(status: ExternalListStatus): WatchStatus {
  switch (status) {
    case 'CURRENT':    return 'PAUSED';     // Currently watching → treat as paused mid-series
    case 'COMPLETED':  return 'COMPLETED';
    case 'PLANNING':   return 'DISCOVERED';
    case 'DROPPED':    return 'DROPPED';    // §15 bug 2 fix: DROPPED enum now exists
    case 'PAUSED':     return 'PAUSED';
    case 'REPEATING':  return 'PAUSED';     // Rewatching → active
    default:           return 'DISCOVERED';
  }
}

// ─── NEVER-REGRESS MERGE ─────────────────────────────────────────────────────

/**
 * Decide whether to apply an imported episode count.
 * Rule: only overwrite if the import is further along than what's already here,
 *       or if no local row exists at all.
 * A user tracking ahead of their AniList list should never see work erased. §13.1
 */
async function shouldApplyImport(
  titleId: string,
  importedEpisodeCount: number,
): Promise<boolean> {
  const progress = await getProgress(titleId);
  if (!progress || !progress.watch_episode_id) return true; // No local row → apply

  // Find local progress absolute number
  const epRows = await query<{ absolute_number: number }>(
    `SELECT absolute_number FROM episode WHERE episode_id=? LIMIT 1`,
    [progress.watch_episode_id],
  );
  if (epRows.length === 0) return true;

  const localEpisode = epRows[0].absolute_number;
  return importedEpisodeCount > localEpisode; // Only advance, never regress
}

// ─── RESOLVE OR CREATE TITLE ROW ─────────────────────────────────────────────

async function resolveOrCreateTitle(entry: ImportedListEntry): Promise<string> {
  // Try to find existing title by anilist_id
  if (entry.anilist_id) {
    const existing = await getTitleByAnilistId(entry.anilist_id);
    if (existing) return existing.title_id;
  }

  // Fetch full metadata from AniList to create a complete title row
  let meta = entry.anilist_id ? await fetchTitleMetadata(entry.anilist_id) : null;

  const titleId = uuidv4();
  await upsertTitle({
    title_id: titleId,
    anilist_id: entry.anilist_id,
    mal_id: entry.mal_id,
    romaji_title: entry.title_romaji,
    english_title: entry.title_english,
    media_format: entry.media_format,
    total_episodes: entry.total_episodes,
    cover_image_url: entry.cover_image_url,
    updated_at: Date.now(),
  });

  // Stub out a season and episodes if we know the count
  // (Full episode data should be populated by the metadata sync job separately)
  if (entry.total_episodes && entry.total_episodes > 0) {
    const seasonId = uuidv4();
    await execute(
      `INSERT OR IGNORE INTO season (season_id, title_id, season_number) VALUES (?,?,1)`,
      [seasonId, titleId],
    );
    // Batched into one transaction per title — a full list import can hit
    // this for hundreds of shows in one run, and long-runners like One
    // Piece (1000+ episodes) would otherwise mean thousands of sequential
    // awaited inserts, which is slow enough to feel like a hang or timeout.
    const episodeCount = Math.min(entry.total_episodes, MAX_STUBBED_EPISODES);
    const episodeOps = [];
    for (let n = 1; n <= episodeCount; n++) {
      episodeOps.push({
        sql: `INSERT OR IGNORE INTO episode
                (episode_id, title_id, season_id, absolute_number, season_episode, canonical_kind)
              VALUES (?,?,?,?,?,'MAIN')`,
        params: [uuidv4(), titleId, seasonId, n, n] as (string | number)[],
      });
    }
    await transaction(episodeOps);
  }

  return titleId;
}

// ─── MAIN IMPORT FUNCTION ────────────────────────────────────────────────────

export interface ImportResult {
  total: number;
  applied: number;
  skipped: number;
  errors: number;
}

/**
 * Pull the user's list from AniList and apply with the never-regress merge rule.
 * Direction: import only. Never auto-pushes. §13.1
 */
export async function runAniListImport(): Promise<ImportResult> {
  const viewer = await fetchViewer();
  if (!viewer) throw new Error('Not authenticated with AniList');

  const entries = await fetchUserList(viewer.name);
  const result: ImportResult = { total: entries.length, applied: 0, skipped: 0, errors: 0 };

  for (const entry of entries) {
    try {
      const titleId = await resolveOrCreateTitle(entry);
      const importedCount = entry.progress_episodes ?? 0;
      const shouldApply = await shouldApplyImport(titleId, importedCount);

      if (!shouldApply) {
        result.skipped++;
        continue;
      }

      const status = mapExternalStatus(entry.external_status);

      if (importedCount > 0) {
        // Find the episode row matching the imported episode count
        const epRows = await query<{ episode_id: string }>(
          `SELECT episode_id FROM episode
           WHERE title_id=? AND absolute_number=? LIMIT 1`,
          [titleId, importedCount],
        );

        if (epRows.length > 0) {
          await recordWatchProgress(
            titleId,
            epRows[0].episode_id,
            0, // External lists don't give us a timestamp — 0 is honest
            'imported', // Will not match a platform_id, but documents provenance
            status,
            'OFFICIAL_API', // §7.2: this is the provenance enum value for imports
          );
        } else {
          // Episode row doesn't exist yet — just set status
          const progress = await getOrCreateProgress(titleId);
          await execute(
            `UPDATE progress SET watch_status=?, provenance='OFFICIAL_API', updated_at=?
             WHERE progress_id=?`,
            [status, Date.now(), progress.progress_id],
          );
        }
      } else {
        const progress = await getOrCreateProgress(titleId);
        await execute(
          `UPDATE progress SET watch_status=?, provenance='OFFICIAL_API', updated_at=?
           WHERE progress_id=?`,
          [status, Date.now(), progress.progress_id],
        );
      }

      // Record external account sync timestamp
      await execute(
        `UPDATE user_external_account SET last_synced_at=? WHERE provider='ANILIST'`,
        [Date.now()],
      );

      result.applied++;
    } catch (e) {
      console.error('[ImportService] Error importing entry:', entry.title_romaji, e);
      result.errors++;
    }
  }

  return result;
}
