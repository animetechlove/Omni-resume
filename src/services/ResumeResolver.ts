// ─────────────────────────────────────────────────────────────────────────────
// src/services/ResumeResolver.ts
// The Switch-Sleuth engine (§1B / §5).
// Determines the best resume action for a given title, building the
// ResumeRecommendation that the dashboard widget and notification payloads read.
// ─────────────────────────────────────────────────────────────────────────────

import { Linking } from 'react-native';
import type {
  Progress, Platform, Availability, UserSubscription,
  PlatformEpisode, ResumeRecommendation, ProgressPayload,
  SourceEntry, Title, Episode,
} from '../types';
import { getProgress } from '../db/dao/ProgressDAO';
import {
  getTitleById, getEpisode, getAvailability, getPlatformEpisode,
  getAllPlatforms, getPlatform, getUserSubscriptions,
} from '../db/dao/TitleDAO';
import { markMigrated, markUnavailable } from '../db/dao/ProgressDAO';

// ─── MONETIZATION RANK ───────────────────────────────────────────────────────
// Lower = preferred. FREE/SUB first, then ADS, then RENT/BUY. §5 resolver.

const MONETIZATION_RANK: Record<string, number> = {
  FREE: 0,
  ADS:  1,
  SUB:  2,
  RENT: 10,
  BUY:  11,
};

// ─── DEEP LINK BUILDER ───────────────────────────────────────────────────────

/**
 * Build a deep link for a given platform episode.
 * If the platform officially documents a timestamp parameter, include it.
 * Otherwise, link to the episode only and rely on the ~timestamp UI convention.
 * §5 resume resolver / §9 matrix.
 */
export function buildDeepLink(
  pe: PlatformEpisode,
  platform: Platform,
  timestampMs: number,
): { url: string; carries_timestamp: boolean } {
  const template = pe.deep_link_template;

  if (!template) {
    // Fallback: construct a best-effort web URL from the platform's web_base_url
    const base = platform.web_base_url ?? '';
    return {
      url: `${base}/watch/${pe.platform_asset_id}`,
      carries_timestamp: false,
    };
  }

  const timestampSec = Math.floor(timestampMs / 1000);
  const carries_timestamp = platform.supports_timestamp && timestampMs > 0;

  const url = template
    .replace('{asset_id}', pe.platform_asset_id)
    .replace('{t}', carries_timestamp ? String(timestampSec) : '');

  // Clean up any trailing '?t=' or '&t=' if timestamp wasn't included
  const cleanUrl = url.replace(/[?&]t=$/, '');

  return { url: cleanUrl, carries_timestamp };
}

// ─── FORMAT HELPERS ──────────────────────────────────────────────────────────

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ─── CORE RESOLVER ───────────────────────────────────────────────────────────

interface ResolveInput {
  titleId: string;
  region: string;
}

/**
 * Resolve the best resume action for a title.
 * Returns a full ProgressPayload including ResumeRecommendation.
 *
 * Algorithm (§5):
 *  1. Primary platform available + user has it → happy path
 *  2. Primary gone or user lost access → Switch-Sleuth
 *     a. Find all available + user-subscribed alternates
 *     b. Rank: supports_timestamp DESC, monetization rank ASC, freshness DESC
 *     c. If found → MIGRATED, stage recommendation
 *     d. If not found → UNAVAILABLE
 */
export async function resolve(input: ResolveInput): Promise<ProgressPayload | null> {
  const { titleId, region } = input;

  const [title, progress] = await Promise.all([
    getTitleById(titleId),
    getProgress(titleId),
  ]);
  if (!title || !progress) return null;

  const episode = progress.watch_episode_id
    ? await getEpisode(progress.watch_episode_id)
    : null;

  const [availabilities, subscriptions] = await Promise.all([
    getAvailability(titleId, region),
    getUserSubscriptions(true),
  ]);

  const subscribedPlatformIds = new Set(subscriptions.map(s => s.platform_id));

  // Fetch all platforms once outside the loop — calling getAllPlatforms() per
  // availability entry (the prior bug) made N DB round-trips for N platforms.
  const allPlatforms = await getAllPlatforms();
  const platformMap = new Map(allPlatforms.map(p => [p.platform_id, p]));

  // Build source entries for all platforms that have this title available
  const sources: SourceEntry[] = [];
  for (const avail of availabilities) {
    const plat = platformMap.get(avail.platform_id);
    if (!plat) continue;

    const sub = subscriptions.find(s => s.platform_id === avail.platform_id);

    let pe: PlatformEpisode | undefined;
    if (episode) {
      const peResult = await getPlatformEpisode(avail.platform_id, episode.episode_id, region);
      pe = peResult ?? undefined;
    }

    sources.push({
      platform: plat,
      subscription: sub ?? {
        user_subscription_id: '',
        platform_id: avail.platform_id,
        region,
        source: 'DECLARED',
        is_active: false,
      },
      availability: avail,
      platform_episode: pe,
      deep_link: pe
        ? buildDeepLink(pe, plat, progress.watch_timestamp_ms).url
        : undefined,
      modes: {
        watch: !plat.supports_play_mode,
        play: Boolean(plat.supports_play_mode),
      },
    });
  }

  // ── Determine recommendation ──
  const recommendation = await computeRecommendation(
    progress, episode, sources, subscriptions, region,
  );

  return {
    title,
    episode: episode ?? undefined,
    progress,
    sources,
    resume_recommendation: recommendation,
  };
}

async function computeRecommendation(
  progress: Progress,
  episode: Episode | null,
  sources: SourceEntry[],
  subscriptions: UserSubscription[],
  region: string,
): Promise<ResumeRecommendation> {
  const primaryId = progress.last_platform_id;

  // Case 1: primary platform is still available and user has it
  if (primaryId) {
    const primary = sources.find(s =>
      s.platform.platform_id === primaryId &&
      s.availability.is_available &&
      s.subscription.is_active,
    );
    if (primary && episode && primary.platform_episode) {
      const { url, carries_timestamp } = buildDeepLink(
        primary.platform_episode,
        primary.platform,
        progress.watch_timestamp_ms,
      );
      const tsLabel = carries_timestamp
        ? formatTimestamp(progress.watch_timestamp_ms)
        : `~${formatTimestamp(progress.watch_timestamp_ms)}`;
      return {
        reason: 'OK',
        from_platform_id: primaryId,
        to_platform_id: primaryId,
        deep_link: url,
        carries_timestamp,
        timestamp_ms: progress.watch_timestamp_ms,
        episode_label: primary.platform_episode.platform_ep_label ?? undefined,
        prompt: `Resume ${carries_timestamp ? 'at' : 'near'} ${tsLabel}`,
      };
    }
  }

  // Case 2: Switch-Sleuth — find best alternate
  const candidates = sources.filter(
    s =>
      s.platform.platform_id !== primaryId &&
      s.availability.is_available &&
      s.subscription.is_active &&
      !s.platform.supports_play_mode, // Only Watch-mode platforms
  );

  if (candidates.length === 0) {
    // Case 3: nothing available → UNAVAILABLE
    if (progress.watch_status !== 'UNAVAILABLE') {
      await markUnavailable(progress.title_id);
    }
    return {
      reason: 'NO_ALTERNATE',
      carries_timestamp: false,
      prompt: 'Not available on your services right now.',
    };
  }

  // Rank: timestamp support first, then monetization, then freshness
  const ranked = [...candidates].sort((a, b) => {
    const tsA = a.platform.supports_timestamp ? 0 : 1;
    const tsB = b.platform.supports_timestamp ? 0 : 1;
    if (tsA !== tsB) return tsA - tsB;

    const mA = MONETIZATION_RANK[a.availability.monetization] ?? 5;
    const mB = MONETIZATION_RANK[b.availability.monetization] ?? 5;
    if (mA !== mB) return mA - mB;

    return b.availability.last_checked_at - a.availability.last_checked_at;
  });

  const best = ranked[0];
  if (progress.watch_status !== 'MIGRATED') {
    await markMigrated(progress.title_id);
  }

  const { url, carries_timestamp } = best.platform_episode
    ? buildDeepLink(best.platform_episode, best.platform, progress.watch_timestamp_ms)
    : { url: best.platform.web_base_url ?? '', carries_timestamp: false };

  const tsLabel = formatTimestamp(progress.watch_timestamp_ms);
  const monetLabel = best.availability.monetization === 'FREE' ? ' (free)' :
    best.availability.monetization === 'RENT' ? ' (rental)' : '';

  return {
    reason: 'PRIMARY_UNAVAILABLE',
    from_platform_id: primaryId ?? undefined,
    to_platform_id: best.platform.platform_id,
    deep_link: url,
    carries_timestamp,
    timestamp_ms: progress.watch_timestamp_ms,
    episode_label: best.platform_episode?.platform_ep_label ?? undefined,
    prompt: `Stream moved. Open on ${best.platform.display_name}${monetLabel} near ${tsLabel} — tap to switch.`,
  };
}

// ─── LAUNCH ──────────────────────────────────────────────────────────────────

/**
 * Execute the resume: open the deep link.
 * Falls through gracefully if the URL can't be opened (app not installed etc.)
 */
export async function launchDeepLink(url: string): Promise<boolean> {
  try {
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      // Fallback: strip scheme to https
      const httpsUrl = url.replace(/^[a-z]+:\/\//, 'https://');
      await Linking.openURL(httpsUrl);
      return true;
    }
    await Linking.openURL(url);
    return true;
  } catch (e) {
    console.error('[ResumeResolver] Failed to open URL:', url, e);
    return false;
  }
}
