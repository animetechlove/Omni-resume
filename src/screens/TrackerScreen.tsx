// ─────────────────────────────────────────────────────────────────────────────
// src/screens/TrackerScreen.tsx
// Per-show tracker screen. Organizes episodes by season → arc → canonical kind.
// Implements §7.1b (episode grid tap), long-press platform picker, rewatch
// (§13.3), and shelf status management (§13.2).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Modal, Alert, Image, Switch,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { Colors, Fonts, FontSizes, Spacing, bevelBorder } from '../theme/pixelTheme';
import { Panel, PixelButton, WatchStatusPill, EpisodeGrid } from '../components/PixelUI';
import type {
  Title, Season, Arc, Episode, Progress, Platform,
  UserSubscription, WatchHistory, CompletionEvent, ShelfStatus,
} from '../types';
import {
  getTitleById, getSeasonsForTitle, getArcsForTitle,
  getEpisodesForTitle, getUserSubscriptions, getAllPlatforms,
  getWatchHistory, getCompletionEvents, backfillMissingEpisodes,
} from '../db/dao/TitleDAO';
import {
  getOrCreateProgress, recordWatchProgress, setShelfStatus, startRewatch,
} from '../db/dao/ProgressDAO';
import { seedKnownArcs, assignEpisodesToArcs } from '../services/ArcService';

type RouteParams = { title_id: string };

// Episodes per page. Long-runners (One Piece, Dragon Ball Z) would otherwise
// render every episode of the season as tiles in one unbounded grid — slow
// to render and painful to scroll. Paginating by absolute episode number
// (not per-arc) means a show under 100 episodes (Tokyo Ghoul) stays a
// single page, while a 291-episode show (DBZ) becomes 3 and a 1000+
// episode show (One Piece) becomes ~11.
const PAGE_SIZE = 100;

// ─── EPISODE STATE HELPER ─────────────────────────────────────────────────────

function episodeState(
  ep: Episode,
  currentAbsolute: number,
): 'watched' | 'current' | 'upcoming' | 'ova' {
  if (ep.canonical_kind === 'OVA' || ep.canonical_kind === 'SPECIAL') return 'ova';
  if (ep.absolute_number < currentAbsolute) return 'watched';
  if (ep.absolute_number === currentAbsolute) return 'current';
  return 'upcoming';
}

// ─── ARC PROGRESS ────────────────────────────────────────────────────────────

interface ArcProgressInfo {
  arcName: string;
  percent: number;
  completedArcs: number;
  totalArcs: number;
}

/**
 * Anime watchers tend to remember "I'm mid-Frieza Saga" more readily than
 * "episode 87 of 291" — this reframes raw episode progress in arc terms.
 * Returns null when the show has no curated arc data (most shows, for now).
 */
function computeArcProgress(
  arcsIn: Arc[],
  currentAbsolute: number,
  totalEpisodes: number,
): ArcProgressInfo | null {
  if (arcsIn.length === 0 || totalEpisodes <= 0) return null;

  const sorted = [...arcsIn].sort((a, b) => a.arc_index - b.arc_index);
  const ranges = sorted.map((arc, i) => ({
    arc,
    start: arc.starts_at_abs,
    end: i + 1 < sorted.length ? sorted[i + 1].starts_at_abs - 1 : totalEpisodes,
  }));

  const completedArcs = ranges.filter(r => currentAbsolute >= r.end).length;

  // First arc not yet fully watched — or the last one, once everything is
  const current = ranges.find(r => currentAbsolute < r.end) ?? ranges[ranges.length - 1];
  const arcTotal = Math.max(1, current.end - current.start + 1);
  const watchedInArc = Math.min(Math.max(currentAbsolute - current.start + 1, 0), arcTotal);
  const percent = Math.round((watchedInArc / arcTotal) * 100);

  return { arcName: current.arc.name, percent, completedArcs, totalArcs: ranges.length };
}

// ─── PLATFORM PICKER MODAL ────────────────────────────────────────────────────

interface PlatformPickerProps {
  visible: boolean;
  platforms: Platform[];
  subscriptions: UserSubscription[];
  selectedId?: string;
  onSelect: (platformId: string) => void;
  onCancel: () => void;
}

function PlatformPickerModal({
  visible, platforms, subscriptions, selectedId, onSelect, onCancel,
}: PlatformPickerProps) {
  const subscribedIds = new Set(subscriptions.map(s => s.platform_id));
  const available = platforms.filter(
    p => subscribedIds.has(p.platform_id) && p.platform_id !== 'omni_companion',
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={pickerStyles.backdrop}>
        <View style={pickerStyles.sheet}>
          <Text style={pickerStyles.heading}>WHERE DID YOU WATCH?</Text>
          {available.map(p => (
            <TouchableOpacity
              key={p.platform_id}
              style={[
                pickerStyles.row,
                selectedId === p.platform_id && pickerStyles.rowActive,
              ]}
              onPress={() => onSelect(p.platform_id)}
            >
              <Text style={pickerStyles.cursor}>
                {selectedId === p.platform_id ? '▶ ' : '   '}
              </Text>
              <Text style={pickerStyles.platformName}>{p.display_name.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
          <PixelButton label="CANCEL" onPress={onCancel} color={Colors.dim} textColor={Colors.cream} style={{ marginTop: Spacing.md }} />
        </View>
      </View>
    </Modal>
  );
}

const pickerStyles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(11,14,26,0.9)',
    justifyContent: 'center', padding: Spacing.lg,
  },
  sheet: {
    backgroundColor: Colors.panel,
    ...bevelBorder(3),
    padding: Spacing.lg,
  },
  heading: {
    fontFamily: Fonts.display, fontSize: FontSizes.displayXs,
    color: Colors.gold, marginBottom: Spacing.md, letterSpacing: 1,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.borderMid,
  },
  rowActive: { borderBottomColor: Colors.gold },
  cursor: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.gold },
  platformName: { fontFamily: Fonts.body, fontSize: FontSizes.bodyLg, color: Colors.cream },
});

// ─── SEASON TAB ──────────────────────────────────────────────────────────────

interface SeasonTabsProps {
  seasons: Season[];
  active: string;
  onSelect: (id: string) => void;
}

function SeasonTabs({ seasons, active, onSelect }: SeasonTabsProps) {
  if (seasons.length <= 1) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={tabStyles.scroll}>
      {seasons.map(s => (
        <TouchableOpacity
          key={s.season_id}
          onPress={() => onSelect(s.season_id)}
          style={[tabStyles.tab, active === s.season_id && tabStyles.tabActive]}
          accessibilityRole="tab"
          accessibilityState={{ selected: active === s.season_id }}
        >
          <Text style={[tabStyles.label, active === s.season_id && tabStyles.labelActive]}>
            {s.label ?? `SEASON ${s.season_number}`}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const tabStyles = StyleSheet.create({
  scroll: { marginBottom: Spacing.md },
  tab: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderWidth: 2, borderColor: Colors.borderMid,
    marginRight: Spacing.sm, backgroundColor: Colors.panelDeep,
  },
  tabActive: { borderColor: Colors.gold, backgroundColor: Colors.panel },
  label: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.dim },
  labelActive: { color: Colors.gold },
});

// ─── WATCH HISTORY PANEL ─────────────────────────────────────────────────────

function WatchHistoryPanel({ history, completions }: {
  history: WatchHistory[];
  completions: CompletionEvent[];
}) {
  if (history.length === 0 && completions.length === 0) return null;

  const formatDate = (ms: number) => new Date(ms).toLocaleDateString();

  return (
    <Panel label="WATCH HISTORY">
      {completions.map(c => (
        <View key={c.completion_event_id} style={histStyles.row}>
          <Text style={histStyles.pass}>PASS {c.viewing_pass}</Text>
          <Text style={histStyles.detail}>
            {c.episodes_count} eps · {formatDate(c.completed_at)}
          </Text>
          <Text style={[histStyles.badge, { color: Colors.mint }]}>✓ DONE</Text>
        </View>
      ))}
    </Panel>
  );
}

const histStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: Spacing.xs, gap: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.borderMid,
  },
  pass: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.gold, flex: 1 },
  detail: { fontFamily: Fonts.body, fontSize: FontSizes.bodyMd, color: Colors.dim, flex: 2 },
  badge: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs },
});

// ─── PAGE NAV ────────────────────────────────────────────────────────────────

interface PageNavProps {
  page: number;
  totalPages: number;
  totalEpisodes: number;
  onSelect: (page: number) => void;
}

function PageNav({ page, totalPages, totalEpisodes, onSelect }: PageNavProps) {
  if (totalPages <= 1) return null;
  const rangeStart = page * PAGE_SIZE + 1;
  const rangeEnd = Math.min((page + 1) * PAGE_SIZE, totalEpisodes);
  return (
    <View style={pageNavStyles.wrap}>
      <Text style={pageNavStyles.rangeLabel}>EP {rangeStart}–{rangeEnd} OF {totalEpisodes}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={pageNavStyles.row}>
        <TouchableOpacity
          disabled={page === 0}
          onPress={() => onSelect(page - 1)}
          style={[pageNavStyles.pageBtn, page === 0 && pageNavStyles.pageBtnDisabled]}
        >
          <Text style={[pageNavStyles.pageBtnText, page === 0 && pageNavStyles.pageBtnTextDisabled]}>‹</Text>
        </TouchableOpacity>
        {Array.from({ length: totalPages }, (_, i) => (
          <TouchableOpacity
            key={i}
            onPress={() => onSelect(i)}
            style={[pageNavStyles.pageBtn, i === page && pageNavStyles.pageBtnActive]}
          >
            <Text style={[pageNavStyles.pageBtnText, i === page && pageNavStyles.pageBtnTextActive]}>
              {i + 1}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          disabled={page === totalPages - 1}
          onPress={() => onSelect(page + 1)}
          style={[pageNavStyles.pageBtn, page === totalPages - 1 && pageNavStyles.pageBtnDisabled]}
        >
          <Text style={[pageNavStyles.pageBtnText, page === totalPages - 1 && pageNavStyles.pageBtnTextDisabled]}>›</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const pageNavStyles = StyleSheet.create({
  wrap: { marginTop: Spacing.sm },
  rangeLabel: {
    fontFamily: Fonts.display, fontSize: 8,
    color: Colors.dim, letterSpacing: 1, marginBottom: Spacing.xs,
  },
  row: { gap: Spacing.xs },
  pageBtn: {
    minWidth: 32, paddingHorizontal: Spacing.xs, paddingVertical: 6,
    borderWidth: 2, borderColor: Colors.borderMid,
    backgroundColor: Colors.panelDeep, alignItems: 'center', justifyContent: 'center',
  },
  pageBtnActive: { borderColor: Colors.gold, backgroundColor: Colors.panel },
  pageBtnDisabled: { opacity: 0.4 },
  pageBtnText: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.dim },
  pageBtnTextActive: { color: Colors.gold },
  pageBtnTextDisabled: { color: Colors.borderMid },
});

// ─── MAIN SCREEN ─────────────────────────────────────────────────────────────

export default function TrackerScreen() {
  const route = useRoute<RouteProp<Record<string, RouteParams>, string>>();
  const navigation = useNavigation<any>();
  const { title_id } = route.params;

  const [title, setTitle] = useState<Title | null>(null);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [arcs, setArcs] = useState<Arc[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [subscriptions, setSubscriptions] = useState<UserSubscription[]>([]);
  const [history, setHistory] = useState<WatchHistory[]>([]);
  const [completions, setCompletions] = useState<CompletionEvent[]>([]);

  const [activeSeason, setActiveSeason] = useState<string>('');
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pendingEpisode, setPendingEpisode] = useState<Episode | null>(null);
  const [rawPage, setRawPage] = useState(0);
  const didInitPageRef = useRef(false);

  const load = useCallback(async () => {
    const [t, p, s, a, eps, plats, subs, hist, comps] = await Promise.all([
      getTitleById(title_id),
      getOrCreateProgress(title_id),
      getSeasonsForTitle(title_id),
      getArcsForTitle(title_id),
      getEpisodesForTitle(title_id),
      getAllPlatforms(),
      getUserSubscriptions(true),
      getWatchHistory(title_id),
      getCompletionEvents(title_id),
    ]);

    let arcs = a;
    let episodesList = eps;

    // Fill in any episode rows missing between what's stored and the
    // title's real total_episodes — covers titles added before an
    // episode-stub cap was lifted, or ongoing shows that have aired more
    // since being added (e.g. One Piece).
    let backfilled = false;
    if (t?.total_episodes && s.length > 0 && episodesList.length < t.total_episodes) {
      try {
        backfilled = await backfillMissingEpisodes(title_id, s[0].season_id, t.total_episodes);
        if (backfilled) episodesList = await getEpisodesForTitle(title_id);
      } catch (e) {
        console.error('[TrackerScreen] episode backfill failed', e);
      }
    }

    // No arc breakdown yet — try seeding a known one (e.g. Dragon Ball Z's
    // sagas) before giving up and showing episodes as one flat list.
    if (arcs.length === 0 && t?.anilist_id) {
      try {
        const seeded = await seedKnownArcs(title_id, t.anilist_id);
        if (seeded) {
          [arcs, episodesList] = await Promise.all([
            getArcsForTitle(title_id),
            getEpisodesForTitle(title_id),
          ]);
        }
      } catch (e) {
        console.error('[TrackerScreen] arc seeding failed', e);
      }
    } else if (arcs.length > 0 && backfilled) {
      // Arcs already existed but we just backfilled new episode rows —
      // those wouldn't otherwise ever get assigned to an arc.
      try {
        await assignEpisodesToArcs(title_id);
        episodesList = await getEpisodesForTitle(title_id);
      } catch (e) {
        console.error('[TrackerScreen] arc reassignment failed', e);
      }
    }

    setTitle(t);
    setProgress(p);
    setSeasons(s);
    setArcs(arcs);
    setEpisodes(episodesList);
    setPlatforms(plats);
    setSubscriptions(subs);
    setHistory(hist);
    setCompletions(comps);
    if (s.length > 0 && !activeSeason) setActiveSeason(s[0].season_id);
  }, [title_id]);

  useEffect(() => { load(); }, [load]);

  const currentAbsolute = episodes.find(
    e => e.episode_id === progress?.watch_episode_id,
  )?.absolute_number ?? 0;

  const arcProgress = computeArcProgress(
    arcs, currentAbsolute, title?.total_episodes ?? 0,
  );

  // Episodes for the active season, ordered so paging by absolute number is stable
  const seasonEpisodes = episodes
    .filter(e => !activeSeason || e.season_id === activeSeason)
    .sort((a, b) => a.absolute_number - b.absolute_number);

  // Paginate by absolute episode number, not per-arc — a 291-episode show
  // (DBZ) becomes 3 pages, a 1000+ episode show (One Piece) becomes ~11,
  // and anything under 100 episodes (Tokyo Ghoul) stays a single page.
  const totalPages = Math.max(1, Math.ceil(seasonEpisodes.length / PAGE_SIZE));
  const page = Math.min(rawPage, totalPages - 1);
  const pageEpisodes = seasonEpisodes.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Land on the page containing the episode the user last watched, rather
  // than always page 1 — so continuing a long show doesn't mean paging
  // forward through everything already watched.
  useEffect(() => {
    if (didInitPageRef.current || seasonEpisodes.length === 0) return;
    const idx = seasonEpisodes.findIndex(e => e.episode_id === progress?.watch_episode_id);
    setRawPage(idx >= 0 ? Math.floor(idx / PAGE_SIZE) : 0);
    didInitPageRef.current = true;
  }, [seasonEpisodes, progress]);

  // Group episodes by arc within the active season and page
  type ArcGroup = { arc: Arc | null; episodes: Episode[] };
  const arcGroups: ArcGroup[] = [];
  const arcMap = new Map(arcs.map(a => [a.arc_id, a]));

  const grouped = new Map<string | null, Episode[]>();
  for (const ep of pageEpisodes) {
    const key = ep.arc_id ?? null;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(ep);
  }

  // Ordered: arcs first (by arc_index), then ungrouped
  const sortedArcs = arcs
    .filter(a => grouped.has(a.arc_id))
    .sort((a, b) => a.arc_index - b.arc_index);

  for (const arc of sortedArcs) {
    arcGroups.push({ arc, episodes: grouped.get(arc.arc_id) ?? [] });
  }
  if (grouped.has(null)) {
    arcGroups.push({ arc: null, episodes: grouped.get(null) ?? [] });
  }

  // ── Episode tile tap: single tap marks through that episode ──
  const handleTileTap = async (episodeId: string, absoluteNumber: number) => {
    if (!progress) return;
    if (absoluteNumber <= currentAbsolute) {
      Alert.alert('Already watched', `Marked through Episode ${currentAbsolute}.`);
      return;
    }
    const total = title?.total_episodes ?? 0;
    const newStatus = absoluteNumber === total ? 'COMPLETED' : 'PAUSED';
    await recordWatchProgress(
      title_id, episodeId, 0,
      progress.last_platform_id ?? '',
      newStatus, 'MANUAL',
    );
    if (newStatus === 'COMPLETED') {
      Alert.alert('🎉 QUEST COMPLETE', `${title?.english_title ?? title?.romaji_title ?? ''} finished!`);
    }
    await load();
  };

  // ── Long press: open platform picker first, then mark ──
  const handleTileLongPress = (ep: Episode) => {
    setPendingEpisode(ep);
    setPickerVisible(true);
  };

  const handlePlatformSelected = async (platformId: string) => {
    if (!pendingEpisode || !progress) return;
    setPickerVisible(false);
    const total = title?.total_episodes ?? 0;
    const newStatus = pendingEpisode.absolute_number === total ? 'COMPLETED' : 'PAUSED';
    await recordWatchProgress(
      title_id, pendingEpisode.episode_id, 0,
      platformId, newStatus, 'MANUAL',
    );
    setPendingEpisode(null);
    await load();
  };

  // ── Shelf / Rewatch actions ──
  const handleSetShelf = async (status: ShelfStatus) => {
    await setShelfStatus(title_id, status);
    Alert.alert(
      status === 'ARCHIVED' ? 'Archived' : status === 'SNOOZED' ? 'Snoozed' : 'Restored',
      status === 'ARCHIVED'
        ? 'Moved to archive. Find it in Library → Archived.'
        : status === 'SNOOZED'
        ? 'Snoozed. We won\'t nudge you about this for 30 days.'
        : 'Back in your active library.',
    );
    await load();
  };

  const handleRewatch = async () => {
    Alert.alert(
      '▶ WATCH AGAIN?',
      'This will archive the current completed run and reset to Episode 1. Your arc unlocks are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start Rewatch',
          onPress: async () => {
            await startRewatch(title_id);
            await load();
          },
        },
      ],
    );
  };

  if (!title) return null;

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      {/* Header */}
      <Panel>
        <View style={styles.header}>
          {title.cover_image_url && (
            <Image source={{ uri: title.cover_image_url }} style={styles.cover} />
          )}
          <View style={styles.headerText}>
            <Text style={styles.titleName} numberOfLines={2}>
              {title.english_title ?? title.romaji_title}
            </Text>
            <Text style={styles.titleMeta}>
              {title.media_format} · {title.total_episodes ?? '?'} EPS
            </Text>
            {progress && (
              <WatchStatusPill status={progress.watch_status} />
            )}
          </View>
        </View>

        {/* Arc progress — how far through the current saga, not just the episode count */}
        {arcProgress && (
          <View style={styles.arcProgressWrap}>
            <Text style={styles.arcProgressText}>
              {arcProgress.arcName.toUpperCase()} — {arcProgress.percent}%
            </Text>
            <View style={styles.arcProgressBarWrap}>
              <View style={[styles.arcProgressBarFill, { width: `${arcProgress.percent}%` }]} />
            </View>
            <Text style={styles.arcProgressSubLabel}>
              {arcProgress.completedArcs} / {arcProgress.totalArcs} ARCS COMPLETE
            </Text>
          </View>
        )}

        {/* Shelf actions */}
        {progress && progress.watch_status !== 'COMPLETED' && (
          <View style={styles.shelfRow}>
            {progress.shelf_status !== 'SNOOZED' && (
              <TouchableOpacity style={styles.shelfBtn} onPress={() => handleSetShelf('SNOOZED')}>
                <Text style={styles.shelfBtnText}>⏸ SNOOZE</Text>
              </TouchableOpacity>
            )}
            {progress.shelf_status !== 'ARCHIVED' && (
              <TouchableOpacity style={styles.shelfBtn} onPress={() => handleSetShelf('ARCHIVED')}>
                <Text style={styles.shelfBtnText}>📦 ARCHIVE</Text>
              </TouchableOpacity>
            )}
            {progress.shelf_status !== 'ACTIVE' && (
              <TouchableOpacity style={[styles.shelfBtn, { borderColor: Colors.mint }]} onPress={() => handleSetShelf('ACTIVE')}>
                <Text style={[styles.shelfBtnText, { color: Colors.mint }]}>↩ RESTORE</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Rewatch */}
        {progress?.watch_status === 'COMPLETED' && (
          <PixelButton
            label="▶ WATCH AGAIN"
            onPress={handleRewatch}
            color={Colors.violet}
            style={{ marginTop: Spacing.sm }}
          />
        )}

        {/* Franchise map link */}
        <TouchableOpacity
          style={styles.franchiseLink}
          onPress={() => navigation.navigate('FranchiseMap', { title_id })}
        >
          <Text style={styles.franchiseLinkText}>◈ VIEW FRANCHISE MAP →</Text>
        </TouchableOpacity>
      </Panel>

      {/* Season tabs */}
      <SeasonTabs
        seasons={seasons}
        active={activeSeason}
        onSelect={id => { setActiveSeason(id); setRawPage(0); }}
      />

      {/* Arc / episode groups */}
      {arcGroups.map((group, i) => (
        <Panel
          key={group.arc?.arc_id ?? `ungrouped-${i}`}
          label={group.arc ? `ARC ${group.arc.arc_index + 1}: ${group.arc.name.toUpperCase()}` : 'EPISODES'}
        >
          {/* Arc lock indicator */}
          {group.arc && progress && group.arc.arc_index >= progress.unlocked_arc_index && (
            <View style={styles.lockBadge}>
              <Text style={styles.lockText}>
                🔒 PLAY CONTENT LOCKED — WATCH THROUGH THIS ARC TO UNLOCK
              </Text>
            </View>
          )}

          <EpisodeGrid
            episodes={group.episodes.map(ep => ({
              ...ep,
              status: episodeState(ep, currentAbsolute),
            }))}
            onTileTap={handleTileTap}
            onTileLongPress={(episodeId, absoluteNumber) => {
              const ep = group.episodes.find(e => e.episode_id === episodeId);
              if (ep) handleTileLongPress(ep);
            }}
          />

          {/* Legend row */}
          <View style={styles.legend}>
            <Text style={styles.legendText}>TAP = MARK WATCHED</Text>
            <Text style={styles.legendText}>LONG PRESS = SET PLATFORM</Text>
          </View>
        </Panel>
      ))}

      {/* Episode pages — only shown once a season crosses 100 episodes */}
      <PageNav
        page={page}
        totalPages={totalPages}
        totalEpisodes={seasonEpisodes.length}
        onSelect={setRawPage}
      />

      {/* Watch history */}
      <WatchHistoryPanel history={history} completions={completions} />

      {/* Platform picker modal */}
      <PlatformPickerModal
        visible={pickerVisible}
        platforms={platforms}
        subscriptions={subscriptions}
        selectedId={progress?.last_platform_id}
        onSelect={handlePlatformSelected}
        onCancel={() => { setPickerVisible(false); setPendingEpisode(null); }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.void },
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  header: { flexDirection: 'row', gap: Spacing.md, alignItems: 'flex-start' },
  cover: {
    width: 72, height: 100,
    borderWidth: 2, borderColor: Colors.borderMid,
  },
  headerText: { flex: 1 },
  titleName: {
    fontFamily: Fonts.display, fontSize: FontSizes.displaySm,
    color: Colors.cream, lineHeight: 22, marginBottom: Spacing.xs,
  },
  titleMeta: { fontFamily: Fonts.body, fontSize: FontSizes.bodyMd, color: Colors.dim },
  arcProgressWrap: { marginTop: Spacing.sm },
  arcProgressText: {
    fontFamily: Fonts.display, fontSize: FontSizes.displayXs,
    color: Colors.gold, marginBottom: Spacing.xs, letterSpacing: 0.5,
  },
  arcProgressBarWrap: {
    height: 6, backgroundColor: Colors.panelDeep,
    borderWidth: 1, borderColor: Colors.borderMid, overflow: 'hidden',
  },
  arcProgressBarFill: { height: '100%', backgroundColor: Colors.mint },
  arcProgressSubLabel: {
    fontFamily: Fonts.body, fontSize: FontSizes.bodySm,
    color: Colors.dim, marginTop: 4,
  },
  shelfRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  shelfBtn: {
    flex: 1, paddingVertical: Spacing.sm,
    borderWidth: 2, borderColor: Colors.borderMid,
    alignItems: 'center',
  },
  shelfBtnText: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.dim },
  franchiseLink: { marginTop: Spacing.md, alignSelf: 'flex-end' },
  franchiseLinkText: { fontFamily: Fonts.body, fontSize: FontSizes.bodyMd, color: Colors.blue },
  lockBadge: {
    backgroundColor: Colors.panelDeep, padding: Spacing.sm,
    borderWidth: 1, borderColor: Colors.borderMid, marginBottom: Spacing.sm,
  },
  lockText: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.dim },
  legend: {
    flexDirection: 'row', justifyContent: 'space-between',
    marginTop: Spacing.sm,
    borderTopWidth: 1, borderTopColor: Colors.borderMid, paddingTop: Spacing.xs,
  },
  legendText: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.dim },
});
