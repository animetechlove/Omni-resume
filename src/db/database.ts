// ─────────────────────────────────────────────────────────────────────────────
// src/db/database.ts
// expo-sqlite v15 (Expo SDK 52) — synchronous open, async queries.
// ─────────────────────────────────────────────────────────────────────────────

import * as SQLite from 'expo-sqlite';

const DB_NAME = 'omni_resume.db';
let _db: SQLite.SQLiteDatabase | null = null;

// ─── OPEN & CONFIGURE ────────────────────────────────────────────────────────

export function getDatabase(): SQLite.SQLiteDatabase {
  if (_db) return _db;
  _db = SQLite.openDatabaseSync(DB_NAME);
  // Pragmas must be set on every connection open — not persisted in the file
  _db.execSync('PRAGMA foreign_keys = ON');
  _db.execSync('PRAGMA journal_mode = WAL');
  return _db;
}

// ─── MIGRATIONS ──────────────────────────────────────────────────────────────

let _migrated = false;

export async function runMigrations(): Promise<void> {
  if (_migrated) return;
  const db = getDatabase();

  db.execSync(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL DEFAULT 0)`);

  const row = db.getFirstSync<{ version: number }>(`SELECT version FROM schema_version LIMIT 1`);
  if (!row) {
    db.execSync(`INSERT INTO schema_version VALUES (0)`);
  }

  const current = row?.version ?? 0;
  if (current >= 1) { _migrated = true; return; }

  // Migration 1 — full initial schema
  db.execSync(`
    CREATE TABLE IF NOT EXISTS title (
      title_id TEXT PRIMARY KEY, anilist_id INTEGER UNIQUE, mal_id INTEGER UNIQUE,
      tmdb_id INTEGER, romaji_title TEXT NOT NULL, english_title TEXT,
      media_format TEXT, total_episodes INTEGER, cover_image_url TEXT,
      updated_at INTEGER NOT NULL );

    CREATE TABLE IF NOT EXISTS season (
      season_id TEXT PRIMARY KEY,
      title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
      season_number INTEGER NOT NULL, label TEXT,
      UNIQUE(title_id, season_number) );

    CREATE TABLE IF NOT EXISTS arc (
      arc_id TEXT PRIMARY KEY,
      title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
      arc_index INTEGER NOT NULL, name TEXT NOT NULL, starts_at_abs INTEGER NOT NULL,
      UNIQUE(title_id, arc_index) );

    CREATE TABLE IF NOT EXISTS episode (
      episode_id TEXT PRIMARY KEY,
      title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
      season_id TEXT NOT NULL REFERENCES season(season_id) ON DELETE CASCADE,
      absolute_number INTEGER NOT NULL, season_episode INTEGER NOT NULL,
      canonical_kind TEXT NOT NULL DEFAULT 'MAIN',
      arc_id TEXT REFERENCES arc(arc_id) ON DELETE SET NULL,
      runtime_ms INTEGER, title_text TEXT,
      UNIQUE(title_id, absolute_number) );

    CREATE TABLE IF NOT EXISTS platform (
      platform_id TEXT PRIMARY KEY, display_name TEXT NOT NULL,
      auth_type TEXT NOT NULL, deep_link_scheme TEXT, web_base_url TEXT,
      supports_timestamp INTEGER NOT NULL DEFAULT 0,
      supports_play_mode INTEGER NOT NULL DEFAULT 0 );

    CREATE TABLE IF NOT EXISTS platform_title (
      platform_title_id TEXT PRIMARY KEY,
      title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
      platform_id TEXT NOT NULL REFERENCES platform(platform_id),
      platform_series_id TEXT NOT NULL, region TEXT NOT NULL,
      numbering_style TEXT NOT NULL, episode_offset INTEGER NOT NULL DEFAULT 0,
      UNIQUE(title_id, platform_id, region) );

    CREATE TABLE IF NOT EXISTS platform_episode (
      platform_episode_id TEXT PRIMARY KEY,
      platform_title_id TEXT NOT NULL REFERENCES platform_title(platform_title_id) ON DELETE CASCADE,
      episode_id TEXT NOT NULL REFERENCES episode(episode_id) ON DELETE CASCADE,
      platform_asset_id TEXT NOT NULL, platform_ep_label TEXT,
      is_combined INTEGER NOT NULL DEFAULT 0, combined_span INTEGER NOT NULL DEFAULT 1,
      deep_link_template TEXT,
      UNIQUE(platform_title_id, episode_id) );

    CREATE TABLE IF NOT EXISTS availability (
      availability_id TEXT PRIMARY KEY,
      title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
      platform_id TEXT NOT NULL REFERENCES platform(platform_id),
      region TEXT NOT NULL, monetization TEXT NOT NULL,
      is_available INTEGER NOT NULL DEFAULT 1, data_provider TEXT NOT NULL,
      last_checked_at INTEGER NOT NULL,
      UNIQUE(title_id, platform_id, region) );

    CREATE TABLE IF NOT EXISTS user_subscription (
      user_subscription_id TEXT PRIMARY KEY,
      platform_id TEXT NOT NULL REFERENCES platform(platform_id),
      region TEXT NOT NULL, source TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(platform_id, region) );

    CREATE TABLE IF NOT EXISTS progress (
      progress_id TEXT PRIMARY KEY,
      title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
      watch_episode_id TEXT REFERENCES episode(episode_id),
      watch_timestamp_ms INTEGER NOT NULL DEFAULT 0,
      watch_status TEXT NOT NULL DEFAULT 'DISCOVERED',
      last_platform_id TEXT REFERENCES platform(platform_id),
      provenance TEXT NOT NULL DEFAULT 'MANUAL',
      play_status TEXT NOT NULL DEFAULT 'NONE',
      play_save_ref TEXT,
      unlocked_arc_index INTEGER NOT NULL DEFAULT 0,
      active_mode TEXT NOT NULL DEFAULT 'WATCH',
      viewing_pass INTEGER NOT NULL DEFAULT 1,
      shelf_status TEXT NOT NULL DEFAULT 'ACTIVE',
      last_decay_prompt_at INTEGER,
      updated_at INTEGER NOT NULL,
      UNIQUE(title_id) );

    CREATE TABLE IF NOT EXISTS mode_session (
      session_id TEXT PRIMARY KEY,
      title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
      mode TEXT NOT NULL,
      platform_id TEXT REFERENCES platform(platform_id),
      episode_id TEXT REFERENCES episode(episode_id),
      started_at INTEGER NOT NULL, ended_at INTEGER,
      scheduled_notification_ref TEXT, end_reason TEXT );

    CREATE TABLE IF NOT EXISTS title_relation (
      title_relation_id TEXT PRIMARY KEY,
      from_title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
      to_title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
      relation_type TEXT NOT NULL,
      UNIQUE(from_title_id, to_title_id, relation_type) );

    CREATE TABLE IF NOT EXISTS franchise (
      franchise_id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT );

    CREATE TABLE IF NOT EXISTS franchise_title (
      franchise_id TEXT NOT NULL REFERENCES franchise(franchise_id) ON DELETE CASCADE,
      title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
      watch_order_position REAL, is_required INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (franchise_id, title_id) );

    CREATE TABLE IF NOT EXISTS user_external_account (
      account_id TEXT PRIMARY KEY, provider TEXT NOT NULL,
      external_user_id TEXT NOT NULL, access_token TEXT NOT NULL,
      refresh_token TEXT, connected_at INTEGER NOT NULL,
      last_synced_at INTEGER, sync_mode TEXT NOT NULL DEFAULT 'ONE_TIME',
      UNIQUE(provider) );

    CREATE TABLE IF NOT EXISTS watch_history (
      watch_history_id TEXT PRIMARY KEY,
      title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
      viewing_pass INTEGER NOT NULL, started_at INTEGER,
      completed_at INTEGER NOT NULL, total_watch_time_ms INTEGER,
      UNIQUE(title_id, viewing_pass) );

    CREATE TABLE IF NOT EXISTS airing_schedule (
      title_id TEXT PRIMARY KEY REFERENCES title(title_id) ON DELETE CASCADE,
      next_absolute_number INTEGER, airs_at INTEGER,
      last_refreshed_at INTEGER NOT NULL );

    CREATE TABLE IF NOT EXISTS completion_event (
      completion_event_id TEXT PRIMARY KEY,
      title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
      viewing_pass INTEGER NOT NULL, completed_at INTEGER NOT NULL,
      episodes_count INTEGER NOT NULL, total_watch_time_ms INTEGER NOT NULL,
      UNIQUE(title_id, viewing_pass) );

    CREATE TABLE IF NOT EXISTS title_tag (
      title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
      tag TEXT NOT NULL, PRIMARY KEY (title_id, tag) );

    CREATE INDEX IF NOT EXISTS idx_prog_updated      ON progress(updated_at);
    CREATE INDEX IF NOT EXISTS idx_prog_shelf        ON progress(shelf_status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_avail_recheck     ON availability(last_checked_at);
    CREATE INDEX IF NOT EXISTS idx_avail_title       ON availability(title_id, is_available);
    CREATE INDEX IF NOT EXISTS idx_pep_episode       ON platform_episode(episode_id);
    CREATE INDEX IF NOT EXISTS idx_sub_active        ON user_subscription(is_active);
    CREATE INDEX IF NOT EXISTS idx_relation_from     ON title_relation(from_title_id);
    CREATE INDEX IF NOT EXISTS idx_relation_to       ON title_relation(to_title_id);
    CREATE INDEX IF NOT EXISTS idx_franchise_order   ON franchise_title(franchise_id, watch_order_position);
    CREATE INDEX IF NOT EXISTS idx_session_open      ON mode_session(ended_at, title_id);
    CREATE INDEX IF NOT EXISTS idx_tag_lookup        ON title_tag(tag);
    CREATE INDEX IF NOT EXISTS idx_history_title     ON watch_history(title_id);
    CREATE INDEX IF NOT EXISTS idx_episode_title_abs ON episode(title_id, absolute_number);

    INSERT OR IGNORE INTO platform VALUES
      ('crunchyroll','Crunchyroll','NONE','crunchyroll://','https://www.crunchyroll.com',0,0),
      ('netflix','Netflix','NONE',NULL,'https://www.netflix.com',0,0),
      ('hulu','Hulu','NONE',NULL,'https://www.hulu.com',0,0),
      ('prime','Amazon Prime','NONE',NULL,'https://www.amazon.com',0,0),
      ('pluto','Pluto TV','NONE',NULL,'https://pluto.tv',0,0),
      ('roku','Roku','DEVICE_LINK',NULL,NULL,0,0),
      ('disney','Disney+','NONE',NULL,'https://www.disneyplus.com',0,0),
      ('max','Max','NONE',NULL,'https://www.max.com',0,0),
      ('peacock','Peacock','NONE',NULL,'https://www.peacocktv.com',0,0),
      ('paramount','Paramount+','NONE',NULL,'https://www.paramountplus.com',0,0),
      ('tubi','Tubi','NONE',NULL,'https://tubitv.com',0,0),
      ('hidive','HiDive','NONE',NULL,'https://www.hidive.com',0,0),
      ('youtube','YouTube','OAUTH','vnd.youtube://','https://www.youtube.com',1,0),
      ('omni_companion','Omni Companion','NONE',NULL,NULL,0,1);
  `);

  db.runSync(`UPDATE schema_version SET version = 1`);
  _migrated = true;
  console.log('[DB] Migration 1 complete');
}

// ─── QUERY HELPERS ────────────────────────────────────────────────────────────

export async function query<T>(
  sql: string,
  params: (string | number | null)[] = [],
): Promise<T[]> {
  const db = getDatabase();
  return db.getAllAsync<T>(sql, params);
}

export async function execute(
  sql: string,
  params: (string | number | null)[] = [],
): Promise<SQLite.SQLiteRunResult> {
  const db = getDatabase();
  return db.runAsync(sql, params);
}

export async function transaction(
  ops: Array<{ sql: string; params?: (string | number | null)[] }>,
): Promise<void> {
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    for (const op of ops) {
      await db.runAsync(op.sql, op.params ?? []);
    }
  });
}
