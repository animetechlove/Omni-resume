// ─────────────────────────────────────────────────────────────────────────────
// src/types/index.ts
// Single source of truth for every TypeScript type in Omni-Resume.
// §3 of the spec defines the canonical schema; these types mirror it exactly.
// ─────────────────────────────────────────────────────────────────────────────

// ─── ENUMS ───────────────────────────────────────────────────────────────────

export type MediaFormat = 'TV' | 'MOVIE' | 'OVA' | 'ONA' | 'SPECIAL';

export type CanonicalKind = 'MAIN' | 'OVA' | 'RECAP' | 'SPECIAL' | 'MOVIE';

export type RelationType =
  | 'PREQUEL'
  | 'SEQUEL'
  | 'SIDE_STORY'
  | 'SPIN_OFF'
  | 'ALTERNATIVE'
  | 'SUMMARY'
  | 'ADAPTATION'
  | 'PARENT'
  | 'COMPILATION'
  | 'CONTAINS'
  | 'OTHER';

export type AuthType = 'OAUTH' | 'NONE' | 'DEVICE_LINK';

export type NumberingStyle = 'ABSOLUTE' | 'SEASON_RESET' | 'COMBINED' | 'EXPLICIT';

export type Monetization = 'SUB' | 'ADS' | 'FREE' | 'RENT' | 'BUY';

export type DataProvider = 'justwatch' | 'tmdb' | 'watchmode' | 'first_party';

export type SubscriptionSource = 'DECLARED' | 'OAUTH_VERIFIED';

/** Every possible value for progress.watch_status. §3 + §16 changelog. */
export type WatchStatus =
  | 'DISCOVERED'   // in library, not started
  | 'STREAMING'    // session open right now  — set by startWatchSession()
  | 'PAUSED'       // mid-episode, session closed
  | 'MIGRATED'     // primary platform gone, alternate found, awaiting tap-to-confirm
  | 'UNAVAILABLE'  // primary gone, no alternate in user's declared subscriptions — §1B step 6
  | 'COMPLETED'    // all episodes finished
  | 'DROPPED';     // user chose to stop — needed for AniList/MAL import §13.1

/** Every possible value for progress.play_status. §5 transition table. */
export type PlayStatus = 'NONE' | 'PLAYING' | 'PAUSED' | 'COMPLETED';

export type ActiveMode = 'WATCH' | 'PLAY';

/** Why a mode_session closed — determines closeModeSession() safety-net logic. §7.2 */
export type SessionEndReason = 'PAUSED' | 'COMPLETED' | 'MIGRATED' | 'BACKGROUNDED' | 'ERROR';

export type ShelfStatus = 'ACTIVE' | 'SNOOZED' | 'ARCHIVED';

export type Provenance = 'MANUAL' | 'IN_APP_SDK' | 'OFFICIAL_API';

export type SyncMode = 'ONE_TIME' | 'PERIODIC_PULL';

export type ExternalProvider = 'ANILIST' | 'MAL';

/** AniList/MAL list status → WatchStatus mapping used in §13.1 import. */
export type ExternalListStatus = 'CURRENT' | 'COMPLETED' | 'PLANNING' | 'DROPPED' | 'PAUSED' | 'REPEATING';

// ─── CANONICAL LAYER ─────────────────────────────────────────────────────────

export interface Title {
  title_id: string;
  anilist_id?: number;
  mal_id?: number;
  tmdb_id?: number;
  romaji_title: string;
  english_title?: string;
  media_format?: MediaFormat;
  total_episodes?: number;
  cover_image_url?: string;
  updated_at: number;
}

export interface Season {
  season_id: string;
  title_id: string;
  season_number: number;
  label?: string;
}

export interface Arc {
  arc_id: string;
  title_id: string;
  arc_index: number;
  name: string;
  starts_at_abs: number;
}

export interface Episode {
  episode_id: string;
  title_id: string;
  season_id: string;
  absolute_number: number;
  season_episode: number;
  canonical_kind: CanonicalKind;
  arc_id?: string;
  runtime_ms?: number;
  title_text?: string;
}

// ─── MAPPING LAYER ───────────────────────────────────────────────────────────

export interface Platform {
  platform_id: string;
  display_name: string;
  auth_type: AuthType;
  deep_link_scheme?: string;
  web_base_url?: string;
  supports_timestamp: boolean;   // true ONLY if officially documented — §9 matrix
  supports_play_mode: boolean;
}

export interface PlatformTitle {
  platform_title_id: string;
  title_id: string;
  platform_id: string;
  platform_series_id: string;
  region: string;
  numbering_style: NumberingStyle;
  episode_offset: number;
}

export interface PlatformEpisode {
  platform_episode_id: string;
  platform_title_id: string;
  episode_id: string;
  platform_asset_id: string;
  platform_ep_label?: string;
  is_combined: boolean;
  combined_span: number;
  deep_link_template?: string;
}

export interface Availability {
  availability_id: string;
  title_id: string;
  platform_id: string;
  region: string;
  monetization: Monetization;
  is_available: boolean;
  data_provider: DataProvider;
  last_checked_at: number;
}

// ─── PER-USER STATE ───────────────────────────────────────────────────────────

export interface UserSubscription {
  user_subscription_id: string;
  platform_id: string;
  region: string;
  source: SubscriptionSource;
  is_active: boolean;
}

export interface Progress {
  progress_id: string;
  title_id: string;
  // Watch track
  watch_episode_id?: string;
  watch_timestamp_ms: number;
  watch_status: WatchStatus;
  last_platform_id?: string;
  provenance: Provenance;
  // Play track
  play_status: PlayStatus;
  play_save_ref?: string;
  // Shared gate
  unlocked_arc_index: number;
  active_mode: ActiveMode;
  // Add-on fields §13.2 / §13.3
  viewing_pass: number;
  shelf_status: ShelfStatus;
  last_decay_prompt_at?: number;
  updated_at: number;
}

export interface ModeSession {
  session_id: string;
  title_id: string;
  mode: ActiveMode;
  platform_id?: string;
  episode_id?: string;
  started_at: number;
  ended_at?: number;
  scheduled_notification_ref?: string;
  end_reason?: SessionEndReason;
}

// ─── CROSS-TITLE LAYER ───────────────────────────────────────────────────────

export interface TitleRelation {
  title_relation_id: string;
  from_title_id: string;
  to_title_id: string;
  relation_type: RelationType;
}

export interface Franchise {
  franchise_id: string;
  name: string;
  description?: string;
}

export interface FranchiseTitle {
  franchise_id: string;
  title_id: string;
  watch_order_position?: number;
  is_required: boolean;
}

// ─── ADD-ON TABLES §13 ───────────────────────────────────────────────────────

export interface UserExternalAccount {
  account_id: string;
  provider: ExternalProvider;
  external_user_id: string;
  access_token: string;     // encrypted at rest — §13.1
  refresh_token?: string;
  connected_at: number;
  last_synced_at?: number;
  sync_mode: SyncMode;
}

export interface WatchHistory {
  watch_history_id: string;
  title_id: string;
  viewing_pass: number;
  started_at?: number;
  completed_at: number;
  total_watch_time_ms?: number;
}

export interface AiringSchedule {
  title_id: string;
  next_absolute_number?: number;
  airs_at?: number;
  last_refreshed_at: number;
}

export interface CompletionEvent {
  completion_event_id: string;
  title_id: string;
  viewing_pass: number;
  completed_at: number;
  episodes_count: number;
  total_watch_time_ms: number;
}

export interface TitleTag {
  title_id: string;
  tag: string;
}

// ─── BUSINESS LOGIC / COMPUTED TYPES ─────────────────────────────────────────

/** Built by ResumeResolver.resolve() and cached in the progress payload §4. */
export interface ResumeRecommendation {
  reason: 'PRIMARY_UNAVAILABLE' | 'NO_ALTERNATE' | 'OK';
  from_platform_id?: string;
  to_platform_id?: string;
  deep_link?: string;
  carries_timestamp: boolean;
  episode_label?: string;
  timestamp_ms?: number;
  prompt?: string;
}

/**
 * Full runtime progress payload §4 — what the dashboard widget reads from.
 * §3 is canonical; this is a computed view over it for convenience.
 */
export interface ProgressPayload {
  title: Title;
  episode?: Episode;
  progress: Progress;
  sources: SourceEntry[];
  resume_recommendation: ResumeRecommendation;
}

export interface SourceEntry {
  platform: Platform;
  subscription: UserSubscription;
  availability: Availability;
  platform_episode?: PlatformEpisode;
  deep_link?: string;
  modes: { watch: boolean; play: boolean };
}

/** Passed from the dozed-off notification (§7.1e) into the check-in sheet. */
export interface CheckInContext {
  session_id: string;
  title_id: string;
  episode_id: string;
  episode_label: string;
  estimated_timestamp_ms: number;
  platform_id?: string;
}

/** Returned by the AniList import flow (§13.1) before merge. */
export interface ImportedListEntry {
  provider: ExternalProvider;
  anilist_id?: number;
  mal_id?: number;
  title_romaji: string;
  title_english?: string;
  external_status: ExternalListStatus;
  progress_episodes?: number;   // how many episodes the external service says done
  score?: number;
  media_format?: MediaFormat;
  total_episodes?: number;
  cover_image_url?: string;
}
