// ─────────────────────────────────────────────────────────────────────────────
// src/db/dao/ProgressDAO.ts
// The most critical DAO in the app — implements the §7.2 write contract:
//   startWatchSession()      → sets watch_status='STREAMING', opens mode_session
//   recordWatchProgress()    → writes watch_* with explicit status + provenance
//   closeModeSession()       → single exit point for every session, with two
//                              guaranteed side effects (notif cancel + STREAMING→PAUSED)
//   startPlaySession()       → sets play_status='PLAYING'
//   savePlayProgress()       → sets play_status='PAUSED', writes play_save_ref
//
// The §5 invariant is structural here:
//   Watch methods NEVER write play_*
//   Play methods NEVER write watch_*
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuidv4 } from 'uuid';
import { execute, query, transaction } from '../database';
import type {
  Progress,
  ModeSession,
  WatchStatus,
  PlayStatus,
  ActiveMode,
  SessionEndReason,
  Provenance,
  ShelfStatus,
} from '../../types';
// NOTE: NotificationService is NOT imported at the top level.
// Doing so would create a circular dependency:
//   ProgressDAO → NotificationService → (dynamic) ProgressDAO
// Instead, cancelScheduled is called via a dynamic import inside closeModeSession only.

// ─── READ ─────────────────────────────────────────────────────────────────────

export async function getProgress(titleId: string): Promise<Progress | null> {
  const rows = await query<Progress>(
    `SELECT * FROM progress WHERE title_id = ? LIMIT 1`,
    [titleId],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  // SQLite stores booleans as integers — coerce nothing; TypeScript handles via types.
  return row;
}

export async function getOrCreateProgress(titleId: string): Promise<Progress> {
  const existing = await getProgress(titleId);
  if (existing) return existing;

  const progressId = uuidv4();
  const now = Date.now();
  await execute(
    `INSERT INTO progress (progress_id, title_id, watch_timestamp_ms, watch_status,
      provenance, play_status, unlocked_arc_index, active_mode, viewing_pass,
      shelf_status, updated_at)
     VALUES (?, ?, 0, 'DISCOVERED', 'MANUAL', 'NONE', 0, 'WATCH', 1, 'ACTIVE', ?)`,
    [progressId, titleId, now],
  );
  return (await getProgress(titleId))!;
}

export async function getAllActiveProgress(): Promise<Progress[]> {
  return query<Progress>(
    `SELECT * FROM progress
     WHERE shelf_status = 'ACTIVE' AND watch_status NOT IN ('COMPLETED','DROPPED')
     ORDER BY updated_at DESC`,
  );
}

export async function getMostRecentlyActive(): Promise<Progress | null> {
  const rows = await query<Progress>(
    `SELECT * FROM progress
     WHERE watch_status NOT IN ('DISCOVERED','COMPLETED','DROPPED','UNAVAILABLE')
     AND shelf_status = 'ACTIVE'
     ORDER BY updated_at DESC LIMIT 1`,
  );
  return rows[0] ?? null;
}

// ─── WATCH TRACK WRITES ───────────────────────────────────────────────────────

/**
 * Open a new watch session. Sets watch_status='STREAMING'.
 * Called when the user taps Watch / Instant Continue — before we have
 * a timestamp to record (that comes later through check-in / §7.1a).
 */
export async function startWatchSession(
  titleId: string,
  episodeId: string,
  platformId: string,
): Promise<ModeSession> {
  const progress = await getOrCreateProgress(titleId);
  const sessionId = uuidv4();
  const now = Date.now();

  await transaction([
    // Open the session
    {
      sql: `INSERT INTO mode_session (session_id, title_id, mode, platform_id, episode_id, started_at)
            VALUES (?, ?, 'WATCH', ?, ?, ?)`,
      params: [sessionId, titleId, platformId, episodeId, now],
    },
    // Set STREAMING — the only place this status is ever written
    {
      sql: `UPDATE progress SET watch_status='STREAMING', watch_episode_id=?,
              last_platform_id=?, active_mode='WATCH', updated_at=?
            WHERE progress_id=?`,
      params: [episodeId, platformId, now, progress.progress_id],
    },
  ]);

  return (await getOpenSession(titleId))!;
}

/**
 * Record a definitive watch check-in result with an explicit status.
 * Used for both "Finished it" (COMPLETED) and "Still watching" (PAUSED).
 * Never called directly by dozed-off or "Nothing changed" paths — those
 * call closeModeSession() instead.
 */
export async function recordWatchProgress(
  titleId: string,
  episodeId: string,
  timestampMs: number,
  platformId: string,
  status: WatchStatus,
  provenance: Provenance,
): Promise<void> {
  const progress = await getOrCreateProgress(titleId);
  const now = Date.now();

  await execute(
    `UPDATE progress SET
       watch_episode_id=?, watch_timestamp_ms=?, watch_status=?,
       last_platform_id=?, provenance=?, active_mode='WATCH', updated_at=?
     WHERE progress_id=?`,
    [episodeId, timestampMs, status, platformId, provenance, now, progress.progress_id],
  );
}

/** Set progress.watch_status to MIGRATED after the resolver stages a recommendation. */
export async function markMigrated(titleId: string): Promise<void> {
  const now = Date.now();
  await execute(
    `UPDATE progress SET watch_status='MIGRATED', updated_at=? WHERE title_id=?`,
    [now, titleId],
  );
}

/** Set progress.watch_status to UNAVAILABLE when no alternate platform is found. §1B step 6. */
export async function markUnavailable(titleId: string): Promise<void> {
  const now = Date.now();
  await execute(
    `UPDATE progress SET watch_status='UNAVAILABLE', updated_at=? WHERE title_id=?`,
    [now, titleId],
  );
}

/**
 * Confirm migration: user tapped "Yes, switch to Hulu."
 * Moves MIGRATED → PAUSED on the new platform, carrying the timestamp.
 */
export async function confirmMigration(
  titleId: string,
  newPlatformId: string,
): Promise<void> {
  const now = Date.now();
  await execute(
    `UPDATE progress SET watch_status='PAUSED', last_platform_id=?, updated_at=?
     WHERE title_id=? AND watch_status='MIGRATED'`,
    [newPlatformId, now, titleId],
  );
}

// ─── PLAY TRACK WRITES ────────────────────────────────────────────────────────

/**
 * Open a Play session. Sets play_status='PLAYING'.
 * NEVER writes any watch_* column — §5 invariant.
 */
export async function startPlaySession(titleId: string): Promise<ModeSession> {
  const progress = await getOrCreateProgress(titleId);
  const sessionId = uuidv4();
  const now = Date.now();

  await transaction([
    {
      sql: `INSERT INTO mode_session (session_id, title_id, mode, started_at)
            VALUES (?, ?, 'PLAY', ?)`,
      params: [sessionId, titleId, now],
    },
    {
      sql: `UPDATE progress SET play_status='PLAYING', active_mode='PLAY', updated_at=?
            WHERE progress_id=?`,
      params: [now, progress.progress_id],
    },
  ]);

  return (await getOpenSession(titleId))!;
}

/**
 * Save play progress and transition PLAYING → PAUSED.
 * NEVER writes any watch_* column — §5 invariant.
 */
export async function savePlayProgress(
  titleId: string,
  playSaveRef: string,
): Promise<void> {
  const progress = await getOrCreateProgress(titleId);
  const now = Date.now();

  await execute(
    `UPDATE progress SET play_status='PAUSED', play_save_ref=?, updated_at=?
     WHERE progress_id=?`,
    [playSaveRef, now, progress.progress_id],
  );
}

// ─── SESSION MANAGEMENT ───────────────────────────────────────────────────────

export async function getOpenSession(titleId: string): Promise<ModeSession | null> {
  const rows = await query<ModeSession>(
    `SELECT * FROM mode_session
     WHERE title_id = ? AND ended_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
    [titleId],
  );
  return rows[0] ?? null;
}

export async function storeNotificationRef(
  sessionId: string,
  notificationRef: string,
): Promise<void> {
  await execute(
    `UPDATE mode_session SET scheduled_notification_ref=? WHERE session_id=?`,
    [notificationRef, sessionId],
  );
}

/**
 * THE single place a mode_session ever closes. §7.2
 *
 * Two guaranteed side effects, in order:
 * 1. Cancel the OS-level notification if one was scheduled.
 * 2. If watch_status is still 'STREAMING', set it to 'PAUSED' as a safety net.
 *    Paths that already called recordWatchProgress() with a real status are
 *    unaffected — they've already moved off STREAMING.
 *
 * This fixes the §16 bug where "Nothing changed" and "Stop for tonight" left
 * watch_status stuck at STREAMING forever.
 */
export async function closeModeSession(
  sessionId: string,
  endReason: SessionEndReason,
): Promise<void> {
  const sessions = await query<ModeSession>(
    `SELECT * FROM mode_session WHERE session_id=? LIMIT 1`,
    [sessionId],
  );
  if (sessions.length === 0) return;
  const session = sessions[0];
  const now = Date.now();

  // ── Side effect 1: cancel scheduled notification ──
  // Dynamic import breaks the ProgressDAO → NotificationService → ProgressDAO cycle.
  if (session.scheduled_notification_ref) {
    const { NotificationService } = await import('../../services/NotificationService');
    await NotificationService.cancelScheduled(session.scheduled_notification_ref);
  }

  // ── Side effect 2: STREAMING safety net ──
  // Only runs if the session was a WATCH session and status is still STREAMING.
  if (session.mode === 'WATCH') {
    await execute(
      `UPDATE progress SET watch_status='PAUSED', updated_at=?
       WHERE title_id=? AND watch_status='STREAMING'`,
      [now, session.title_id],
    );
  }

  // ── Close the session record ──
  await execute(
    `UPDATE mode_session SET ended_at=?, end_reason=? WHERE session_id=?`,
    [now, endReason, sessionId],
  );
}

// ─── ARC / SPOILER GATE ───────────────────────────────────────────────────────

/**
 * Raise unlocked_arc_index if appropriate — called when an episode is marked COMPLETED
 * and it was the last episode in its arc.
 */
export async function maybeRaiseArcGate(
  titleId: string,
  completedAbsoluteNumber: number,
): Promise<boolean> {
  // Find the arc that contains this episode
  const arcs = await query<{ arc_id: string; arc_index: number; starts_at_abs: number }>(
    `SELECT a.arc_id, a.arc_index, a.starts_at_abs
     FROM arc a
     JOIN episode e ON e.arc_id = a.arc_id
     WHERE e.title_id=? AND e.absolute_number=?
     LIMIT 1`,
    [titleId, completedAbsoluteNumber],
  );
  if (arcs.length === 0) return false;

  const arc = arcs[0];

  // Check if this is the last episode in that arc
  const nextInArc = await query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM episode
     WHERE title_id=? AND arc_id=? AND absolute_number > ?
     AND canonical_kind NOT IN ('RECAP','SUMMARY')`,
    [titleId, arc.arc_id, completedAbsoluteNumber],
  );

  if (nextInArc[0].cnt > 0) return false;  // More episodes remain in this arc

  const progress = await getProgress(titleId);
  if (!progress) return false;

  const newIndex = arc.arc_index + 1;
  if (newIndex <= progress.unlocked_arc_index) return false; // Already unlocked

  const now = Date.now();
  await execute(
    `UPDATE progress SET unlocked_arc_index=?, updated_at=? WHERE title_id=?`,
    [newIndex, now, titleId],
  );
  return true;
}

// ─── ADD-ON: SHELF STATUS (§13.2) ─────────────────────────────────────────────

export async function setShelfStatus(
  titleId: string,
  status: ShelfStatus,
): Promise<void> {
  const now = Date.now();
  await execute(
    `UPDATE progress SET shelf_status=?, last_decay_prompt_at=?, updated_at=?
     WHERE title_id=?`,
    [status, now, now, titleId],
  );
}

/** §13.2: find titles that haven't been updated past the decay threshold. */
export async function getDecayingTitles(
  daysThreshold: number = 30,
): Promise<Progress[]> {
  const cutoff = Date.now() - daysThreshold * 24 * 60 * 60 * 1000;
  return query<Progress>(
    `SELECT * FROM progress
     WHERE shelf_status='ACTIVE'
       AND watch_status NOT IN ('COMPLETED','DROPPED','DISCOVERED')
       AND updated_at < ?
       AND (last_decay_prompt_at IS NULL OR last_decay_prompt_at < ?)
     ORDER BY updated_at ASC`,
    [cutoff, cutoff],
  );
}

// ─── ADD-ON: REWATCH (§13.3) ─────────────────────────────────────────────────

/**
 * Archive the current completed pass into watch_history and reset for rewatch.
 * Deliberately does NOT reset unlocked_arc_index — no spoiler risk on a rewatch.
 */
export async function startRewatch(titleId: string): Promise<void> {
  const progress = await getProgress(titleId);
  if (!progress) throw new Error(`No progress row for ${titleId}`);
  if (progress.watch_status !== 'COMPLETED') {
    throw new Error(`Cannot start rewatch: status is ${progress.watch_status}, not COMPLETED`);
  }

  const firstEp = await query<{ episode_id: string }>(
    `SELECT episode_id FROM episode
     WHERE title_id=? ORDER BY absolute_number ASC LIMIT 1`,
    [titleId],
  );
  if (firstEp.length === 0) throw new Error(`No episodes found for ${titleId}`);

  const now = Date.now();
  const historyId = uuidv4();

  await transaction([
    // Archive completed pass into watch_history (no updated_at column in this table)
    {
      sql: `INSERT OR IGNORE INTO watch_history
              (watch_history_id, title_id, viewing_pass, completed_at)
            VALUES (?, ?, ?, ?)`,
      params: [historyId, titleId, progress.viewing_pass, progress.updated_at],
    },
    // Reset progress for the new pass, keep unlocked_arc_index
    {
      sql: `UPDATE progress SET
              watch_episode_id=?, watch_timestamp_ms=0, watch_status='PAUSED',
              provenance='MANUAL', viewing_pass=?, updated_at=?
            WHERE title_id=?`,
      params: [firstEp[0].episode_id, progress.viewing_pass + 1, now, titleId],
    },
  ]);
}
