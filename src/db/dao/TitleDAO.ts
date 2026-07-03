// ─────────────────────────────────────────────────────────────────────────────
// src/db/dao/TitleDAO.ts
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuidv4 } from 'uuid';
import { execute, query, transaction } from '../database';
import type {
  Title, Season, Arc, Episode, Platform, PlatformTitle,
  PlatformEpisode, UserSubscription, Availability, TitleRelation,
  Franchise, FranchiseTitle, AiringSchedule, WatchHistory,
  CompletionEvent,
} from '../../types';

// ─── TITLE ───────────────────────────────────────────────────────────────────

export async function getTitleById(titleId: string): Promise<Title | null> {
  const rows = await query<Title>(`SELECT * FROM title WHERE title_id=? LIMIT 1`, [titleId]);
  return rows[0] ?? null;
}

export async function getTitleByAnilistId(anilistId: number): Promise<Title | null> {
  const rows = await query<Title>(`SELECT * FROM title WHERE anilist_id=? LIMIT 1`, [anilistId]);
  return rows[0] ?? null;
}

export async function getTitleByMalId(malId: number): Promise<Title | null> {
  const rows = await query<Title>(`SELECT * FROM title WHERE mal_id=? LIMIT 1`, [malId]);
  return rows[0] ?? null;
}

export async function upsertTitle(title: Omit<Title, 'title_id'> & { title_id?: string }): Promise<string> {
  const titleId = title.title_id ?? uuidv4();
  await execute(
    `INSERT INTO title (title_id, anilist_id, mal_id, tmdb_id, romaji_title, english_title,
       media_format, total_episodes, cover_image_url, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(title_id) DO UPDATE SET
       romaji_title=excluded.romaji_title, english_title=excluded.english_title,
       media_format=excluded.media_format, total_episodes=excluded.total_episodes,
       cover_image_url=excluded.cover_image_url, updated_at=excluded.updated_at
     ON CONFLICT(anilist_id) DO UPDATE SET
       romaji_title=excluded.romaji_title, english_title=excluded.english_title,
       media_format=excluded.media_format, total_episodes=excluded.total_episodes,
       cover_image_url=excluded.cover_image_url, updated_at=excluded.updated_at
     ON CONFLICT(mal_id) DO UPDATE SET
       romaji_title=excluded.romaji_title, english_title=excluded.english_title,
       media_format=excluded.media_format, total_episodes=excluded.total_episodes,
       cover_image_url=excluded.cover_image_url, updated_at=excluded.updated_at`,
    [titleId, title.anilist_id ?? null, title.mal_id ?? null, title.tmdb_id ?? null,
     title.romaji_title, title.english_title ?? null, title.media_format ?? null,
     title.total_episodes ?? null, title.cover_image_url ?? null, title.updated_at],
  );
  return titleId;
}

export async function searchTitles(query_str: string): Promise<Title[]> {
  const like = `%${query_str}%`;
  return query<Title>(
    `SELECT * FROM title
     WHERE romaji_title LIKE ? OR english_title LIKE ?
     ORDER BY updated_at DESC LIMIT 50`,
    [like, like],
  );
}

// ─── SEASON ──────────────────────────────────────────────────────────────────

export async function getSeasonsForTitle(titleId: string): Promise<Season[]> {
  return query<Season>(
    `SELECT * FROM season WHERE title_id=? ORDER BY season_number`,
    [titleId],
  );
}

export async function upsertSeason(season: Season): Promise<void> {
  await execute(
    `INSERT INTO season (season_id, title_id, season_number, label)
     VALUES (?,?,?,?)
     ON CONFLICT(title_id, season_number) DO UPDATE SET label=excluded.label`,
    [season.season_id, season.title_id, season.season_number, season.label ?? null],
  );
}

// ─── ARC ─────────────────────────────────────────────────────────────────────

export async function getArcsForTitle(titleId: string): Promise<Arc[]> {
  return query<Arc>(
    `SELECT * FROM arc WHERE title_id=? ORDER BY arc_index`,
    [titleId],
  );
}

export async function upsertArc(arc: Arc): Promise<void> {
  await execute(
    `INSERT INTO arc (arc_id, title_id, arc_index, name, starts_at_abs)
     VALUES (?,?,?,?,?)
     ON CONFLICT(title_id, arc_index) DO UPDATE SET
       name=excluded.name, starts_at_abs=excluded.starts_at_abs`,
    [arc.arc_id, arc.title_id, arc.arc_index, arc.name, arc.starts_at_abs],
  );
}

// ─── EPISODE ─────────────────────────────────────────────────────────────────

export async function getEpisode(episodeId: string): Promise<Episode | null> {
  const rows = await query<Episode>(`SELECT * FROM episode WHERE episode_id=? LIMIT 1`, [episodeId]);
  return rows[0] ?? null;
}

export async function getEpisodesForTitle(
  titleId: string,
  seasonId?: string,
): Promise<Episode[]> {
  if (seasonId) {
    return query<Episode>(
      `SELECT * FROM episode WHERE title_id=? AND season_id=? ORDER BY absolute_number`,
      [titleId, seasonId],
    );
  }
  return query<Episode>(
    `SELECT * FROM episode WHERE title_id=? ORDER BY absolute_number`,
    [titleId],
  );
}

export async function getEpisodesForArc(arcId: string): Promise<Episode[]> {
  return query<Episode>(
    `SELECT * FROM episode WHERE arc_id=? ORDER BY absolute_number`,
    [arcId],
  );
}

export async function getNextEpisode(
  titleId: string,
  currentAbsoluteNumber: number,
): Promise<Episode | null> {
  const rows = await query<Episode>(
    `SELECT * FROM episode
     WHERE title_id=? AND absolute_number > ?
       AND canonical_kind NOT IN ('RECAP','SUMMARY')
     ORDER BY absolute_number ASC LIMIT 1`,
    [titleId, currentAbsoluteNumber],
  );
  return rows[0] ?? null;
}

export async function upsertEpisode(episode: Episode): Promise<void> {
  await execute(
    `INSERT INTO episode (episode_id, title_id, season_id, absolute_number,
       season_episode, canonical_kind, arc_id, runtime_ms, title_text)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(title_id, absolute_number) DO UPDATE SET
       canonical_kind=excluded.canonical_kind, arc_id=excluded.arc_id,
       runtime_ms=excluded.runtime_ms, title_text=excluded.title_text`,
    [episode.episode_id, episode.title_id, episode.season_id, episode.absolute_number,
     episode.season_episode, episode.canonical_kind, episode.arc_id ?? null,
     episode.runtime_ms ?? null, episode.title_text ?? null],
  );
}

// ─── PLATFORM & AVAILABILITY ──────────────────────────────────────────────────

export async function getAllPlatforms(): Promise<Platform[]> {
  return query<Platform>(`SELECT * FROM platform ORDER BY display_name`);
}

export async function getPlatform(platformId: string): Promise<Platform | null> {
  const rows = await query<Platform>(
    `SELECT * FROM platform WHERE platform_id=? LIMIT 1`,
    [platformId],
  );
  return rows[0] ?? null;
}

export async function getUserSubscriptions(activeOnly: boolean = true): Promise<UserSubscription[]> {
  if (activeOnly) {
    return query<UserSubscription>(`SELECT * FROM user_subscription WHERE is_active=1`);
  }
  return query<UserSubscription>(`SELECT * FROM user_subscription`);
}

export async function upsertSubscription(sub: Omit<UserSubscription, 'user_subscription_id'>): Promise<void> {
  const id = uuidv4();
  await execute(
    `INSERT INTO user_subscription (user_subscription_id, platform_id, region, source, is_active)
     VALUES (?,?,?,?,1)
     ON CONFLICT(platform_id, region) DO UPDATE SET source=excluded.source, is_active=1`,
    [id, sub.platform_id, sub.region, sub.source],
  );
}

export async function deactivateSubscription(platformId: string, region: string): Promise<void> {
  await execute(
    `UPDATE user_subscription SET is_active=0 WHERE platform_id=? AND region=?`,
    [platformId, region],
  );
}

export async function getAvailability(titleId: string, region: string): Promise<Availability[]> {
  return query<Availability>(
    `SELECT a.* FROM availability a
     WHERE a.title_id=? AND a.region=?
     ORDER BY a.is_available DESC`,
    [titleId, region],
  );
}

export async function upsertAvailability(avail: Omit<Availability, 'availability_id'>): Promise<void> {
  const id = uuidv4();
  const now = Date.now();
  await execute(
    `INSERT INTO availability (availability_id, title_id, platform_id, region,
       monetization, is_available, data_provider, last_checked_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(title_id, platform_id, region) DO UPDATE SET
       monetization=excluded.monetization, is_available=excluded.is_available,
       data_provider=excluded.data_provider, last_checked_at=excluded.last_checked_at`,
    [id, avail.title_id, avail.platform_id, avail.region, avail.monetization,
     avail.is_available ? 1 : 0, avail.data_provider, avail.last_checked_at],
  );
}

// ─── PLATFORM EPISODE (deep link bridge) ─────────────────────────────────────

export async function getPlatformEpisode(
  platformId: string,
  episodeId: string,
  region: string,
): Promise<(PlatformEpisode & { platform: Platform }) | null> {
  const rows = await query<PlatformEpisode & { platform_id: string; display_name: string;
    auth_type: string; deep_link_scheme: string | null; web_base_url: string | null;
    supports_timestamp: number; supports_play_mode: number }>(
    `SELECT pe.*, p.platform_id, p.display_name, p.auth_type, p.deep_link_scheme,
       p.web_base_url, p.supports_timestamp, p.supports_play_mode
     FROM platform_episode pe
     JOIN platform_title pt ON pe.platform_title_id = pt.platform_title_id
     JOIN platform p ON pt.platform_id = p.platform_id
     WHERE pt.platform_id=? AND pe.episode_id=? AND pt.region=?
     LIMIT 1`,
    [platformId, episodeId, region],
  );
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    ...row,
    is_combined: Boolean(row.is_combined),
    platform: {
      platform_id: row.platform_id,
      display_name: row.display_name,
      auth_type: row.auth_type as any,
      deep_link_scheme: row.deep_link_scheme ?? undefined,
      web_base_url: row.web_base_url ?? undefined,
      supports_timestamp: Boolean(row.supports_timestamp),
      supports_play_mode: Boolean(row.supports_play_mode),
    },
  };
}

// ─── CROSS-TITLE / FRANCHISE ──────────────────────────────────────────────────

export async function getRelatedTitles(
  titleId: string,
): Promise<(TitleRelation & { related_title: Title })[]> {
  return query<TitleRelation & { related_title: Title }>(
    `SELECT tr.*, t.title_id as r_id, t.romaji_title, t.english_title,
       t.media_format, t.total_episodes, t.cover_image_url, t.updated_at
     FROM title_relation tr
     JOIN title t ON t.title_id = tr.to_title_id
     WHERE tr.from_title_id=?`,
    [titleId],
  );
}

export async function getFranchiseForTitle(titleId: string): Promise<{
  franchise: Franchise;
  entries: Array<FranchiseTitle & { title: Title }>;
} | null> {
  const frRows = await query<{ franchise_id: string; name: string; description?: string }>(
    `SELECT f.* FROM franchise f
     JOIN franchise_title ft ON ft.franchise_id = f.franchise_id
     WHERE ft.title_id=? LIMIT 1`,
    [titleId],
  );
  if (frRows.length === 0) return null;

  const franchise: Franchise = frRows[0];
  const entries = await query<FranchiseTitle & { title: Title }>(
    `SELECT ft.*, t.title_id as t_id, t.romaji_title, t.english_title,
       t.media_format, t.total_episodes, t.cover_image_url, t.updated_at, t.anilist_id
     FROM franchise_title ft
     JOIN title t ON t.title_id = ft.title_id
     WHERE ft.franchise_id=?
     ORDER BY ft.watch_order_position NULLS LAST`,
    [franchise.franchise_id],
  );
  return { franchise, entries };
}

// ─── ADD-ON: AIRING SCHEDULE (§13.4) ─────────────────────────────────────────

export async function getAiringSchedule(titleId: string): Promise<AiringSchedule | null> {
  const rows = await query<AiringSchedule>(
    `SELECT * FROM airing_schedule WHERE title_id=? LIMIT 1`,
    [titleId],
  );
  return rows[0] ?? null;
}

export async function upsertAiringSchedule(schedule: AiringSchedule): Promise<void> {
  await execute(
    `INSERT INTO airing_schedule (title_id, next_absolute_number, airs_at, last_refreshed_at)
     VALUES (?,?,?,?)
     ON CONFLICT(title_id) DO UPDATE SET
       next_absolute_number=excluded.next_absolute_number,
       airs_at=excluded.airs_at, last_refreshed_at=excluded.last_refreshed_at`,
    [schedule.title_id, schedule.next_absolute_number ?? null,
     schedule.airs_at ?? null, schedule.last_refreshed_at],
  );
}

/** All upcoming episodes across tracked titles, sorted by air time. §13.4 radar view. */
export async function getUpcomingEpisodes(): Promise<Array<AiringSchedule & { title: Title }>> {
  const now = Date.now();
  return query<AiringSchedule & { title: Title }>(
    `SELECT sch.*, t.title_id as t_id, t.romaji_title, t.english_title,
       t.cover_image_url, t.updated_at
     FROM airing_schedule sch
     JOIN title t ON t.title_id = sch.title_id
     WHERE sch.airs_at > ? OR sch.airs_at IS NULL
     ORDER BY sch.airs_at ASC NULLS LAST
     LIMIT 50`,
    [now],
  );
}

// ─── ADD-ON: COMPLETION EVENTS (§13.5) ───────────────────────────────────────

export async function createCompletionEvent(
  titleId: string,
  viewingPass: number,
  episodesCount: number,
  totalWatchTimeMs: number,
): Promise<CompletionEvent> {
  const event: CompletionEvent = {
    completion_event_id: uuidv4(),
    title_id: titleId,
    viewing_pass: viewingPass,
    completed_at: Date.now(),
    episodes_count: episodesCount,
    total_watch_time_ms: totalWatchTimeMs,
  };
  await execute(
    `INSERT OR IGNORE INTO completion_event
       (completion_event_id, title_id, viewing_pass, completed_at, episodes_count, total_watch_time_ms)
     VALUES (?,?,?,?,?,?)`,
    [event.completion_event_id, event.title_id, event.viewing_pass,
     event.completed_at, event.episodes_count, event.total_watch_time_ms],
  );
  return event;
}

export async function getCompletionEvents(titleId: string): Promise<CompletionEvent[]> {
  return query<CompletionEvent>(
    `SELECT * FROM completion_event WHERE title_id=? ORDER BY viewing_pass ASC`,
    [titleId],
  );
}

// ─── ADD-ON: TITLE TAGS (§13.6) ──────────────────────────────────────────────

export async function upsertTitleTags(titleId: string, tags: string[]): Promise<void> {
  if (tags.length === 0) return;
  const ops = tags.map(tag => ({
    sql: `INSERT OR IGNORE INTO title_tag (title_id, tag) VALUES (?,?)`,
    params: [titleId, tag] as [string, string],
  }));
  // Uses the statically-imported `transaction` from '../database' — no dynamic import needed
  await transaction(ops);
}

export async function getTitlesByTag(tags: string[]): Promise<Title[]> {
  if (tags.length === 0) return [];
  const placeholders = tags.map(() => '?').join(',');
  return query<Title>(
    `SELECT DISTINCT t.* FROM title t
     JOIN title_tag tt ON tt.title_id = t.title_id
     WHERE tt.tag IN (${placeholders})
     ORDER BY t.updated_at DESC`,
    tags,
  );
}

export async function getAllTags(): Promise<string[]> {
  const rows = await query<{ tag: string }>(
    `SELECT DISTINCT tag FROM title_tag ORDER BY tag`,
  );
  return rows.map(r => r.tag);
}

// ─── ADD-ON: WATCH HISTORY (§13.3) ───────────────────────────────────────────

export async function getWatchHistory(titleId: string): Promise<WatchHistory[]> {
  return query<WatchHistory>(
    `SELECT * FROM watch_history WHERE title_id=? ORDER BY viewing_pass ASC`,
    [titleId],
  );
}
