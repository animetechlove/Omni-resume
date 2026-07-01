-- ─────────────────────────────────────────────────────────────────────────────
-- src/db/schema.sql
-- Complete DDL for Omni-Resume. SQLite-compatible.
-- This is the canonical schema (§3). The §4 JSON payload and TypeScript types
-- in src/types/index.ts are derived from it. If anything conflicts, this wins.
-- ─────────────────────────────────────────────────────────────────────────────

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ─────────────────────────────────────────────────────────────────────────────
-- CANONICAL LAYER — server-synced, identical per user
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS title (
    title_id         TEXT PRIMARY KEY,
    anilist_id       INTEGER UNIQUE,
    mal_id           INTEGER UNIQUE,
    tmdb_id          INTEGER,
    romaji_title     TEXT NOT NULL,
    english_title    TEXT,
    media_format     TEXT,                    -- TV|MOVIE|OVA|ONA|SPECIAL
    total_episodes   INTEGER,
    cover_image_url  TEXT,
    updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS season (
    season_id        TEXT PRIMARY KEY,
    title_id         TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
    season_number    INTEGER NOT NULL,        -- 0 = specials/OVA bucket
    label            TEXT,                    -- "Part 2", "Final Season", etc.
    UNIQUE(title_id, season_number)
);

CREATE TABLE IF NOT EXISTS arc (
    arc_id           TEXT PRIMARY KEY,
    title_id         TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
    arc_index        INTEGER NOT NULL,        -- 0-based
    name             TEXT NOT NULL,
    starts_at_abs    INTEGER NOT NULL,        -- first absolute_number in this arc
    UNIQUE(title_id, arc_index)
);

CREATE TABLE IF NOT EXISTS episode (
    episode_id       TEXT PRIMARY KEY,
    title_id         TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
    season_id        TEXT NOT NULL REFERENCES season(season_id) ON DELETE CASCADE,
    absolute_number  INTEGER NOT NULL,        -- continuous across the whole title
    season_episode   INTEGER NOT NULL,        -- resets each season
    canonical_kind   TEXT NOT NULL DEFAULT 'MAIN',  -- MAIN|OVA|RECAP|SPECIAL|MOVIE
    arc_id           TEXT REFERENCES arc(arc_id) ON DELETE SET NULL,
    runtime_ms       INTEGER,
    title_text       TEXT,
    UNIQUE(title_id, absolute_number)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- MAPPING LAYER — server-synced, regionally scoped
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform (
    platform_id          TEXT PRIMARY KEY,
    display_name         TEXT NOT NULL,
    auth_type            TEXT NOT NULL,       -- OAUTH|NONE|DEVICE_LINK
    deep_link_scheme     TEXT,
    web_base_url         TEXT,
    supports_timestamp   INTEGER NOT NULL DEFAULT 0, -- 1 ONLY if officially documented §9
    supports_play_mode   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS platform_title (
    platform_title_id    TEXT PRIMARY KEY,
    title_id             TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
    platform_id          TEXT NOT NULL REFERENCES platform(platform_id),
    platform_series_id   TEXT NOT NULL,
    region               TEXT NOT NULL,
    numbering_style      TEXT NOT NULL,       -- ABSOLUTE|SEASON_RESET|COMBINED|EXPLICIT
    episode_offset       INTEGER NOT NULL DEFAULT 0,
    UNIQUE(title_id, platform_id, region)
);

-- Authoritative per-episode bridge: resolves OVA / combined / offset drift.
-- Every platform asset points back at a canonical episode_id. §3 explains why.
CREATE TABLE IF NOT EXISTS platform_episode (
    platform_episode_id  TEXT PRIMARY KEY,
    platform_title_id    TEXT NOT NULL REFERENCES platform_title(platform_title_id) ON DELETE CASCADE,
    episode_id           TEXT NOT NULL REFERENCES episode(episode_id) ON DELETE CASCADE,
    platform_asset_id    TEXT NOT NULL,
    platform_ep_label    TEXT,
    is_combined          INTEGER NOT NULL DEFAULT 0,
    combined_span        INTEGER NOT NULL DEFAULT 1,
    deep_link_template   TEXT,               -- official scheme only — §9
    UNIQUE(platform_title_id, episode_id)
);

CREATE TABLE IF NOT EXISTS availability (
    availability_id      TEXT PRIMARY KEY,
    title_id             TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
    platform_id          TEXT NOT NULL REFERENCES platform(platform_id),
    region               TEXT NOT NULL,
    monetization         TEXT NOT NULL,      -- SUB|ADS|FREE|RENT|BUY
    is_available         INTEGER NOT NULL DEFAULT 1,
    data_provider        TEXT NOT NULL,      -- §0: 'justwatch'|'tmdb'|'watchmode'|'first_party'
    last_checked_at      INTEGER NOT NULL,
    UNIQUE(title_id, platform_id, region)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- PER-USER STATE — local cache, synced up to server
-- ─────────────────────────────────────────────────────────────────────────────

-- §0 compliance: replaces account-probing. Populated by self-declaration or OAuth.
CREATE TABLE IF NOT EXISTS user_subscription (
    user_subscription_id TEXT PRIMARY KEY,
    platform_id          TEXT NOT NULL REFERENCES platform(platform_id),
    region               TEXT NOT NULL,
    source               TEXT NOT NULL,      -- DECLARED|OAUTH_VERIFIED
    is_active            INTEGER NOT NULL DEFAULT 1,
    UNIQUE(platform_id, region)
);

CREATE TABLE IF NOT EXISTS progress (
    progress_id          TEXT PRIMARY KEY,
    title_id             TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
    -- Watch track
    watch_episode_id     TEXT REFERENCES episode(episode_id),
    watch_timestamp_ms   INTEGER NOT NULL DEFAULT 0,
    watch_status         TEXT NOT NULL DEFAULT 'DISCOVERED',
        -- DISCOVERED|STREAMING|PAUSED|MIGRATED|UNAVAILABLE|COMPLETED|DROPPED
    last_platform_id     TEXT REFERENCES platform(platform_id),
    provenance           TEXT NOT NULL DEFAULT 'MANUAL',  -- MANUAL|IN_APP_SDK|OFFICIAL_API
    -- Play track
    play_status          TEXT NOT NULL DEFAULT 'NONE',    -- NONE|PLAYING|PAUSED|COMPLETED
    play_save_ref        TEXT,
    -- Shared spoiler gate
    unlocked_arc_index   INTEGER NOT NULL DEFAULT 0,
    active_mode          TEXT NOT NULL DEFAULT 'WATCH',   -- WATCH|PLAY
    -- Add-on feature fields
    viewing_pass         INTEGER NOT NULL DEFAULT 1,      -- §13.3 rewatch
    shelf_status         TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE|SNOOZED|ARCHIVED §13.2
    last_decay_prompt_at INTEGER,                         -- §13.2 backlog decay
    updated_at           INTEGER NOT NULL,
    UNIQUE(title_id)
);

CREATE TABLE IF NOT EXISTS mode_session (
    session_id                TEXT PRIMARY KEY,
    title_id                  TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
    mode                      TEXT NOT NULL,              -- WATCH|PLAY
    platform_id               TEXT REFERENCES platform(platform_id),  -- FK fixed §15 bug 1
    episode_id                TEXT REFERENCES episode(episode_id),
    started_at                INTEGER NOT NULL,
    ended_at                  INTEGER,
    scheduled_notification_ref TEXT,  -- OS notification request ID for cancellation §12.1+§7.2
    end_reason                TEXT    -- PAUSED|COMPLETED|MIGRATED|BACKGROUNDED|ERROR
);

-- ─────────────────────────────────────────────────────────────────────────────
-- CROSS-TITLE LAYER — franchise and relation graph
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS title_relation (
    title_relation_id TEXT PRIMARY KEY,
    from_title_id     TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
    to_title_id       TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
    relation_type     TEXT NOT NULL,
        -- PREQUEL|SEQUEL|SIDE_STORY|SPIN_OFF|ALTERNATIVE|SUMMARY|ADAPTATION|PARENT|COMPILATION|CONTAINS|OTHER
    UNIQUE(from_title_id, to_title_id, relation_type)
);

CREATE TABLE IF NOT EXISTS franchise (
    franchise_id TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT
);

CREATE TABLE IF NOT EXISTS franchise_title (
    franchise_id          TEXT NOT NULL REFERENCES franchise(franchise_id) ON DELETE CASCADE,
    title_id              TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
    watch_order_position  REAL,           -- recommended order, not necessarily release order
    is_required           INTEGER NOT NULL DEFAULT 1,  -- 0 = optional/non-canon
    PRIMARY KEY (franchise_id, title_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- ADD-ON FEATURE TABLES — §13
-- ─────────────────────────────────────────────────────────────────────────────

-- §13.1 AniList/MAL import
CREATE TABLE IF NOT EXISTS user_external_account (
    account_id       TEXT PRIMARY KEY,
    provider         TEXT NOT NULL,          -- ANILIST|MAL
    external_user_id TEXT NOT NULL,
    access_token     TEXT NOT NULL,          -- stored encrypted via react-native-keychain
    refresh_token    TEXT,
    connected_at     INTEGER NOT NULL,
    last_synced_at   INTEGER,
    sync_mode        TEXT NOT NULL DEFAULT 'ONE_TIME',  -- ONE_TIME|PERIODIC_PULL
    UNIQUE(provider)
);

-- §13.3 Re-watch passes: archive of completed viewing passes
CREATE TABLE IF NOT EXISTS watch_history (
    watch_history_id  TEXT PRIMARY KEY,
    title_id          TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
    viewing_pass      INTEGER NOT NULL,
    started_at        INTEGER,
    completed_at      INTEGER NOT NULL,
    total_watch_time_ms INTEGER,
    UNIQUE(title_id, viewing_pass)
);

-- §13.4 Now-airing radar: same poll as §12.2 episode-drop push, persisted for browse view
CREATE TABLE IF NOT EXISTS airing_schedule (
    title_id             TEXT PRIMARY KEY REFERENCES title(title_id) ON DELETE CASCADE,
    next_absolute_number INTEGER,
    airs_at              INTEGER,
    last_refreshed_at    INTEGER NOT NULL
);

-- §13.5 Completion cards: one row per finished viewing pass
CREATE TABLE IF NOT EXISTS completion_event (
    completion_event_id TEXT PRIMARY KEY,
    title_id            TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
    viewing_pass        INTEGER NOT NULL,
    completed_at        INTEGER NOT NULL,
    episodes_count      INTEGER NOT NULL,
    total_watch_time_ms INTEGER NOT NULL,
    UNIQUE(title_id, viewing_pass)
);

-- §13.6 Mood/vibe filter: populated from AniList metadata, no second API call needed
CREATE TABLE IF NOT EXISTS title_tag (
    title_id TEXT NOT NULL REFERENCES title(title_id) ON DELETE CASCADE,
    tag      TEXT NOT NULL,
    PRIMARY KEY (title_id, tag)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_prog_updated      ON progress(updated_at);
CREATE INDEX IF NOT EXISTS idx_prog_shelf        ON progress(shelf_status, updated_at);
CREATE INDEX IF NOT EXISTS idx_avail_recheck     ON availability(last_checked_at);
CREATE INDEX IF NOT EXISTS idx_avail_title       ON availability(title_id, is_available);
CREATE INDEX IF NOT EXISTS idx_pep_episode       ON platform_episode(episode_id);
CREATE INDEX IF NOT EXISTS idx_sub_active        ON user_subscription(is_active);
CREATE INDEX IF NOT EXISTS idx_relation_from     ON title_relation(from_title_id);
CREATE INDEX IF NOT EXISTS idx_relation_to       ON title_relation(to_title_id);   -- §15 bug 4 fix
CREATE INDEX IF NOT EXISTS idx_franchise_order   ON franchise_title(franchise_id, watch_order_position);
CREATE INDEX IF NOT EXISTS idx_session_open      ON mode_session(ended_at, title_id);
CREATE INDEX IF NOT EXISTS idx_tag_lookup        ON title_tag(tag);
CREATE INDEX IF NOT EXISTS idx_history_title     ON watch_history(title_id);
CREATE INDEX IF NOT EXISTS idx_episode_title_abs ON episode(title_id, absolute_number);

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED DATA — platform rows (all supports_timestamp=0 per §9 research)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO platform VALUES
  ('crunchyroll', 'Crunchyroll',    'NONE',        'crunchyroll://', 'https://www.crunchyroll.com', 0, 0),
  ('netflix',     'Netflix',        'NONE',        NULL,             'https://www.netflix.com',     0, 0),
  ('hulu',        'Hulu',           'NONE',        NULL,             'https://www.hulu.com',        0, 0),
  ('prime',       'Amazon Prime',   'NONE',        NULL,             'https://www.amazon.com',      0, 0),
  ('pluto',       'Pluto TV',       'NONE',        NULL,             'https://pluto.tv',            0, 0),
  ('roku',        'Roku',           'DEVICE_LINK', NULL,             NULL,                          0, 0),
  ('disney',      'Disney+',        'NONE',        NULL,             'https://www.disneyplus.com',  0, 0),
  ('max',         'Max',            'NONE',        NULL,             'https://www.max.com',         0, 0),
  ('peacock',     'Peacock',        'NONE',        NULL,             'https://www.peacocktv.com',   0, 0),
  ('paramount',   'Paramount+',     'NONE',        NULL,             'https://www.paramountplus.com',0, 0),
  ('tubi',        'Tubi',           'NONE',        NULL,             'https://tubitv.com',          0, 0),
  ('hidive',      'HiDive',         'NONE',        NULL,             'https://www.hidive.com',      0, 0),
  -- YouTube: the ONE platform with official, documented timestamp support §9
  ('youtube',     'YouTube',        'OAUTH',       'vnd.youtube://', 'https://www.youtube.com',     1, 0),
  -- First-party companion platform for Play mode §1C
  ('omni_companion','Omni Companion','NONE',       NULL,             NULL,                          0, 1);
