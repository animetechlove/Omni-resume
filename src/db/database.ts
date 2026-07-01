// ─────────────────────────────────────────────────────────────────────────────
// src/db/database.ts
// SQLite connection singleton + migration runner.
// Every DAO imports { db } from here — there is exactly one connection.
// ─────────────────────────────────────────────────────────────────────────────

import SQLite from 'react-native-sqlite-storage';

SQLite.enablePromise(true);
SQLite.DEBUG(__DEV__);

const DB_NAME = 'omni_resume.db';
const SCHEMA_VERSION = 1;

let _db: SQLite.SQLiteDatabase | null = null;

// ─── MIGRATION RECORD ────────────────────────────────────────────────────────
// Add new entries here for every future schema change.
// Never alter existing entries — only append.

interface Migration {
  version: number;
  description: string;
  up: string[];
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Initial schema — all tables from §3 of spec',
    up: [
      `PRAGMA foreign_keys = ON`,
      `PRAGMA journal_mode = WAL`,
      `CREATE TABLE IF NOT EXISTS title (
        title_id TEXT PRIMARY KEY, anilist_id INTEGER UNIQUE, mal_id INTEGER UNIQUE,
        tmdb_id INTEGER, romaji_title TEXT NOT NULL, english_title TEXT,
        media_format TEXT, total_episodes INTEGER, cover_image_url TEXT,
        updated_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS season (
        season_id TEXT PRIMARY KEY,
        title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
        season_number INTEGER NOT NULL, label TEXT,
        UNIQUE(title_id, season_number)
      )`,
      `CREATE TABLE IF NOT EXISTS arc (
        arc_id TEXT PRIMARY KEY,
        title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
        arc_index INTEGER NOT NULL, name TEXT NOT NULL, starts_at_abs INTEGER NOT NULL,
        UNIQUE(title_id, arc_index)
      )`,
      `CREATE TABLE IF NOT EXISTS episode (
        episode_id TEXT PRIMARY KEY,
        title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
        season_id TEXT NOT NULL REFERENCES season(season_id) ON DELETE CASCADE,
        absolute_number INTEGER NOT NULL, season_episode INTEGER NOT NULL,
        canonical_kind TEXT NOT NULL DEFAULT 'MAIN',
        arc_id TEXT REFERENCES arc(arc_id) ON DELETE SET NULL,
        runtime_ms INTEGER, title_text TEXT,
        UNIQUE(title_id, absolute_number)
      )`,
      `CREATE TABLE IF NOT EXISTS platform (
        platform_id TEXT PRIMARY KEY, display_name TEXT NOT NULL,
        auth_type TEXT NOT NULL, deep_link_scheme TEXT, web_base_url TEXT,
        supports_timestamp INTEGER NOT NULL DEFAULT 0,
        supports_play_mode INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS platform_title (
        platform_title_id TEXT PRIMARY KEY,
        title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
        platform_id TEXT NOT NULL REFERENCES platform(platform_id),
        platform_series_id TEXT NOT NULL, region TEXT NOT NULL,
        numbering_style TEXT NOT NULL, episode_offset INTEGER NOT NULL DEFAULT 0,
        UNIQUE(title_id, platform_id, region)
      )`,
      `CREATE TABLE IF NOT EXISTS platform_episode (
        platform_episode_id TEXT PRIMARY KEY,
        platform_title_id TEXT NOT NULL REFERENCES platform_title(platform_title_id) ON DELETE CASCADE,
        episode_id TEXT NOT NULL REFERENCES episode(episode_id) ON DELETE CASCADE,
        platform_asset_id TEXT NOT NULL, platform_ep_label TEXT,
        is_combined INTEGER NOT NULL DEFAULT 0, combined_span INTEGER NOT NULL DEFAULT 1,
        deep_link_template TEXT,
        UNIQUE(platform_title_id, episode_id)
      )`,
      `CREATE TABLE IF NOT EXISTS availability (
        availability_id TEXT PRIMARY KEY,
        title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
        platform_id TEXT NOT NULL REFERENCES platform(platform_id),
        region TEXT NOT NULL, monetization TEXT NOT NULL,
        is_available INTEGER NOT NULL DEFAULT 1, data_provider TEXT NOT NULL,
        last_checked_at INTEGER NOT NULL,
        UNIQUE(title_id, platform_id, region)
      )`,
      `CREATE TABLE IF NOT EXISTS user_subscription (
        user_subscription_id TEXT PRIMARY KEY,
        platform_id TEXT NOT NULL REFERENCES platform(platform_id),
        region TEXT NOT NULL, source TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        UNIQUE(platform_id, region)
      )`,
      `CREATE TABLE IF NOT EXISTS progress (
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
        UNIQUE(title_id)
      )`,
      `CREATE TABLE IF NOT EXISTS mode_session (
        session_id TEXT PRIMARY KEY,
        title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
        mode TEXT NOT NULL,
        platform_id TEXT REFERENCES platform(platform_id),
        episode_id TEXT REFERENCES episode(episode_id),
        started_at INTEGER NOT NULL, ended_at INTEGER,
        scheduled_notification_ref TEXT, end_reason TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS title_relation (
        title_relation_id TEXT PRIMARY KEY,
        from_title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
        to_title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
        relation_type TEXT NOT NULL,
        UNIQUE(from_title_id, to_title_id, relation_type)
      )`,
      `CREATE TABLE IF NOT EXISTS franchise (
        franchise_id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS franchise_title (
        franchise_id TEXT NOT NULL REFERENCES franchise(franchise_id) ON DELETE CASCADE,
        title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
        watch_order_position REAL, is_required INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (franchise_id, title_id)
      )`,
      `CREATE TABLE IF NOT EXISTS user_external_account (
        account_id TEXT PRIMARY KEY, provider TEXT NOT NULL,
        external_user_id TEXT NOT NULL, access_token TEXT NOT NULL,
        refresh_token TEXT, connected_at INTEGER NOT NULL,
        last_synced_at INTEGER, sync_mode TEXT NOT NULL DEFAULT 'ONE_TIME',
        UNIQUE(provider)
      )`,
      `CREATE TABLE IF NOT EXISTS watch_history (
        watch_history_id TEXT PRIMARY KEY,
        title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
        viewing_pass INTEGER NOT NULL, started_at INTEGER,
        completed_at INTEGER NOT NULL, total_watch_time_ms INTEGER,
        UNIQUE(title_id, viewing_pass)
      )`,
      `CREATE TABLE IF NOT EXISTS airing_schedule (
        title_id TEXT PRIMARY KEY REFERENCES title(title_id) ON DELETE CASCADE,
        next_absolute_number INTEGER, airs_at INTEGER,
        last_refreshed_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS completion_event (
        completion_event_id TEXT PRIMARY KEY,
        title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
        viewing_pass INTEGER NOT NULL, completed_at INTEGER NOT NULL,
        episodes_count INTEGER NOT NULL, total_watch_time_ms INTEGER NOT NULL,
        UNIQUE(title_id, viewing_pass)
      )`,
      `CREATE TABLE IF NOT EXISTS title_tag (
        title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
        tag TEXT NOT NULL, PRIMARY KEY (title_id, tag)
      )`,
      // Indexes
      `CREATE INDEX IF NOT EXISTS idx_prog_updated      ON progress(updated_at)`,
      `CREATE INDEX IF NOT EXISTS idx_prog_shelf        ON progress(shelf_status, updated_at)`,
      `CREATE INDEX IF NOT EXISTS idx_avail_recheck     ON availability(last_checked_at)`,
      `CREATE INDEX IF NOT EXISTS idx_avail_title       ON availability(title_id, is_available)`,
      `CREATE INDEX IF NOT EXISTS idx_pep_episode       ON platform_episode(episode_id)`,
      `CREATE INDEX IF NOT EXISTS idx_sub_active        ON user_subscription(is_active)`,
      `CREATE INDEX IF NOT EXISTS idx_relation_from     ON title_relation(from_title_id)`,
      `CREATE INDEX IF NOT EXISTS idx_relation_to       ON title_relation(to_title_id)`,
      `CREATE INDEX IF NOT EXISTS idx_franchise_order   ON franchise_title(franchise_id, watch_order_position)`,
      `CREATE INDEX IF NOT EXISTS idx_session_open      ON mode_session(ended_at, title_id)`,
      `CREATE INDEX IF NOT EXISTS idx_tag_lookup        ON title_tag(tag)`,
      `CREATE INDEX IF NOT EXISTS idx_history_title     ON watch_history(title_id)`,
      `CREATE INDEX IF NOT EXISTS idx_episode_title_abs ON episode(title_id, absolute_number)`,
      // Platform seed data — supports_timestamp=1 only for YouTube (§9 research)
      `INSERT OR IGNORE INTO platform VALUES
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
        ('omni_companion','Omni Companion','NONE',NULL,NULL,0,1)`,
    ],
  },
];

// ─── SCHEMA VERSION TABLE ─────────────────────────────────────────────────────

async function ensureVersionTable(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.executeSql(
    `CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL DEFAULT 0)`,
  );
  const [result] = await database.executeSql(`SELECT COUNT(*) as cnt FROM schema_version`);
  if (result.rows.item(0).cnt === 0) {
    await database.executeSql(`INSERT INTO schema_version VALUES (0)`);
  }
}

async function getCurrentVersion(database: SQLite.SQLiteDatabase): Promise<number> {
  const [result] = await database.executeSql(`SELECT version FROM schema_version LIMIT 1`);
  return result.rows.item(0).version as number;
}

async function setVersion(database: SQLite.SQLiteDatabase, version: number): Promise<void> {
  await database.executeSql(`UPDATE schema_version SET version = ?`, [version]);
}

// ─── MIGRATION RUNNER ────────────────────────────────────────────────────────

async function runMigrations(database: SQLite.SQLiteDatabase): Promise<void> {
  await ensureVersionTable(database);
  const current = await getCurrentVersion(database);

  const pending = MIGRATIONS.filter(m => m.version > current);
  if (pending.length === 0) return;

  for (const migration of pending) {
    console.log(`[DB] Applying migration ${migration.version}: ${migration.description}`);
    await database.transaction(async tx => {
      for (const sql of migration.up) {
        await tx.executeSql(sql);
      }
    });
    await setVersion(database, migration.version);
    console.log(`[DB] Migration ${migration.version} applied.`);
  }
}

// ─── SINGLETON ───────────────────────────────────────────────────────────────

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;

  _db = await SQLite.openDatabase({
    name: DB_NAME,
    location: 'default',
  });

  // PRAGMA foreign_keys must be set on every connection open — it is NOT persisted
  // in the database file. Setting it only in the migration SQL is insufficient.
  await _db.executeSql('PRAGMA foreign_keys = ON');
  await _db.executeSql('PRAGMA journal_mode = WAL');

  await runMigrations(_db);
  console.log('[DB] Ready. Schema version:', SCHEMA_VERSION);
  return _db;
}

/** Helper: run a single query and return typed rows. */
export async function query<T>(
  sql: string,
  params: (string | number | null)[] = [],
): Promise<T[]> {
  const database = await getDatabase();
  const [results] = await database.executeSql(sql, params);
  const rows: T[] = [];
  for (let i = 0; i < results.rows.length; i++) {
    rows.push(results.rows.item(i) as T);
  }
  return rows;
}

/** Helper: run a mutation and return insertId / rowsAffected. */
export async function execute(
  sql: string,
  params: (string | number | null)[] = [],
): Promise<SQLite.ResultSet> {
  const database = await getDatabase();
  const [result] = await database.executeSql(sql, params);
  return result;
}

/** Helper: run multiple statements in one transaction. */
export async function transaction(
  ops: Array<{ sql: string; params?: (string | number | null)[] }>,
): Promise<void> {
  const database = await getDatabase();
  await database.transaction(async tx => {
    for (const op of ops) {
      await tx.executeSql(op.sql, op.params ?? []);
    }
  });
}
