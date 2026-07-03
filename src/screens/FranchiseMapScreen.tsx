// ─────────────────────────────────────────────────────────────────────────────
// src/screens/FranchiseMapScreen.tsx
// Franchise map (§7.1d + §3 cross-title layer).
// Entered from a title's TrackerScreen; shows every connected title in
// recommended watch order, with each one's progress state at a glance.
// Optional (is_required=0) titles are dimmed but never hidden.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Image, ActivityIndicator,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { Colors, Fonts, FontSizes, Spacing, bevelBorder } from '../theme/pixelTheme';
import { Panel, PixelButton } from '../components/PixelUI';
import type {
  Title, Franchise, FranchiseTitle, Progress, WatchStatus,
} from '../types';
import { getFranchiseForTitle, getTitleById } from '../db/dao/TitleDAO';
import { getProgress } from '../db/dao/ProgressDAO';
import { buildFranchiseForTitle } from '../services/FranchiseService';

type RouteParams = { title_id: string };

// ─── MEDIA FORMAT LABEL ───────────────────────────────────────────────────────

const FORMAT_TAGS: Record<string, string> = {
  TV:      'TV',
  MOVIE:   'FILM',
  OVA:     'OVA',
  ONA:     'ONA',
  SPECIAL: 'SPECIAL',
};

// ─── RELATION TYPE DISPLAY ────────────────────────────────────────────────────

const RELATION_COLORS: Record<string, string> = {
  PREQUEL:       Colors.blue,
  SEQUEL:        Colors.mint,
  SIDE_STORY:    Colors.violet,
  SPIN_OFF:      Colors.violet,
  ALTERNATIVE:   Colors.coral,
  SUMMARY:       Colors.dim,
  ADAPTATION:    Colors.gold,
  default:       Colors.dim,
};

// ─── FRANCHISE ENTRY ROW ─────────────────────────────────────────────────────

interface FranchiseEntryProps {
  position: number;
  title: Title;
  progress: Progress | null;
  isRequired: boolean;
  isCurrent: boolean;
  onPress: () => void;
}

function FranchiseEntry({
  position, title, progress, isRequired, isCurrent, onPress,
}: FranchiseEntryProps) {
  const statusCfg: Record<WatchStatus, { icon: string; color: string }> = {
    DISCOVERED:  { icon: '▢', color: Colors.borderMid },
    STREAMING:   { icon: '▶', color: Colors.mint      },
    PAUSED:      { icon: '◉', color: Colors.gold      },
    MIGRATED:    { icon: '⇄', color: Colors.blue      },
    UNAVAILABLE: { icon: '⦸', color: Colors.dim       },
    COMPLETED:   { icon: '✓', color: Colors.mint      },
    DROPPED:     { icon: '✗', color: Colors.borderMid },
  };

  const status = progress?.watch_status ?? 'DISCOVERED';
  const cfg = statusCfg[status];

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.entryRow,
        isCurrent && styles.entryRowCurrent,
        !isRequired && styles.entryRowOptional,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${title.english_title ?? title.romaji_title}, ${status}`}
    >
      {/* Position number */}
      <Text style={[styles.entryPos, isCurrent && { color: Colors.gold }]}>
        {position}.
      </Text>

      {/* Cover thumbnail */}
      <View style={styles.entryCover}>
        {title.cover_image_url ? (
          <Image source={{ uri: title.cover_image_url }} style={styles.entryCoverImg} />
        ) : (
          <View style={[styles.entryCoverImg, { backgroundColor: Colors.panelDeep }]} />
        )}
      </View>

      {/* Text block */}
      <View style={styles.entryText}>
        <Text style={[styles.entryTitle, !isRequired && { color: Colors.dim }]} numberOfLines={2}>
          {title.english_title ?? title.romaji_title}
        </Text>
        <View style={styles.entryMeta}>
          {title.media_format && (
            <View style={styles.formatTag}>
              <Text style={styles.formatTagText}>{FORMAT_TAGS[title.media_format] ?? title.media_format}</Text>
            </View>
          )}
          {!isRequired && (
            <View style={[styles.formatTag, { borderColor: Colors.dim }]}>
              <Text style={[styles.formatTagText, { color: Colors.dim }]}>OPTIONAL</Text>
            </View>
          )}
          {title.total_episodes && (
            <Text style={styles.epCount}>{title.total_episodes} EP</Text>
          )}
        </View>
      </View>

      {/* Status icon */}
      <View style={styles.entryStatus}>
        <Text style={[styles.statusIcon, { color: cfg.color }]}>{cfg.icon}</Text>
        <Text style={[styles.statusLabel, { color: cfg.color }]}>
          {status === 'PAUSED' && progress?.watch_timestamp_ms
            ? 'IN PROGRESS'
            : status.replace('_', ' ')}
        </Text>
      </View>

      {/* Arrow */}
      <Text style={styles.entryArrow}>›</Text>
    </TouchableOpacity>
  );
}

// ─── STANDALONE / NO FRANCHISE STATE ─────────────────────────────────────────

function StandaloneState({ onBack }: { onBack: () => void }) {
  return (
    <Panel label="FRANCHISE MAP">
      <Text style={styles.emptyText}>
        This title has no franchise connections yet.{'\n'}
        If it's part of a series, the map will appear here once the data is synced.
      </Text>
      <PixelButton label="← BACK" onPress={onBack} color={Colors.borderMid} textColor={Colors.cream} />
    </Panel>
  );
}

// ─── MAIN SCREEN ─────────────────────────────────────────────────────────────

export default function FranchiseMapScreen() {
  const route = useRoute<RouteProp<Record<string, RouteParams>, string>>();
  const navigation = useNavigation<any>();
  const { title_id } = route.params;

  const [franchise, setFranchise] = useState<Franchise | null>(null);
  const [entries, setEntries] = useState<
    Array<{ franchiseTitle: FranchiseTitle; title: Title; progress: Progress | null }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let result = await getFranchiseForTitle(title_id);

      // No local franchise grouping yet — try building one from AniList's
      // relations graph (prequel/sequel/side-story chain) before giving up.
      if (!result) {
        const rootTitle = await getTitleById(title_id);
        if (rootTitle?.anilist_id) {
          setSyncing(true);
          try {
            await buildFranchiseForTitle(title_id, rootTitle.anilist_id);
          } catch (e) {
            console.error('[FranchiseMapScreen] franchise sync failed', e);
          } finally {
            setSyncing(false);
          }
          result = await getFranchiseForTitle(title_id);
        }
      }

      if (!result) {
        setFranchise(null);
        setEntries([]);
        return;
      }

      setFranchise(result.franchise);

      // Load progress for every title in the franchise in parallel
      const enriched = await Promise.all(
        result.entries.map(async entry => {
          // entry contains joined title fields — reshape into Title type
          const t: Title = {
            title_id:        entry.t_id,
            anilist_id:      entry.anilist_id,
            mal_id:          entry.mal_id,
            tmdb_id:         entry.tmdb_id,
            romaji_title:    entry.romaji_title,
            english_title:   entry.english_title,
            media_format:    entry.media_format,
            total_episodes:  entry.total_episodes,
            cover_image_url: entry.cover_image_url,
            updated_at:      entry.updated_at,
          };
          const p = await getProgress(t.title_id);
          return {
            franchiseTitle: {
              franchise_id:         entry.franchise_id,
              title_id:             t.title_id,
              watch_order_position: entry.watch_order_position,
              is_required:          Boolean(entry.is_required),
            },
            title: t,
            progress: p,
          };
        }),
      );

      setEntries(enriched);
    } catch (e) {
      console.error('[FranchiseMapScreen] failed to load franchise map', e);
      setFranchise(null);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [title_id]);

  useEffect(() => { load(); }, [load]);

  const handleEntryPress = (entryTitleId: string) => {
    navigation.navigate('Tracker', { title_id: entryTitleId });
  };

  // Summary stats
  const completedCount = entries.filter(e => e.progress?.watch_status === 'COMPLETED').length;
  const totalCount = entries.filter(e => e.franchiseTitle.is_required).length;

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={Colors.gold} size="large" />
        <Text style={styles.loadingText}>
          {syncing ? 'SYNCING FRANCHISE DATA...' : 'LOADING FRANCHISE MAP...'}
        </Text>
      </View>
    );
  }

  if (!franchise) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.container}>
        <StandaloneState onBack={() => navigation.goBack()} />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      {/* Franchise header */}
      <Panel label="FRANCHISE MAP">
        <Text style={styles.franchiseName}>{franchise.name.toUpperCase()}</Text>
        {franchise.description && (
          <Text style={styles.franchiseDesc}>{franchise.description}</Text>
        )}

        {/* Progress bar */}
        <View style={styles.progressBarWrap}>
          <View style={[styles.progressBarFill, {
            width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%`,
          }]} />
        </View>
        <Text style={styles.progressLabel}>
          {completedCount} / {totalCount} REQUIRED TITLES COMPLETE
        </Text>
      </Panel>

      {/* Legend */}
      <View style={styles.legend}>
        <Text style={styles.legendItem}><Text style={{ color: Colors.mint }}>✓</Text> done</Text>
        <Text style={styles.legendItem}><Text style={{ color: Colors.gold }}>◉</Text> in progress</Text>
        <Text style={styles.legendItem}><Text style={{ color: Colors.borderMid }}>▢</Text> not started</Text>
        <Text style={styles.legendItem}><Text style={{ color: Colors.dim }}>optional</Text> = skip-safe</Text>
      </View>

      {/* Recommended order label */}
      <Text style={styles.orderNote}>
        ▸ ORDER SHOWN IS RECOMMENDED WATCH ORDER, NOT RELEASE DATE
      </Text>

      {/* Entry list */}
      <Panel label="WATCH ORDER">
        {entries.map((entry, i) => (
          <React.Fragment key={entry.title.title_id}>
            <FranchiseEntry
              position={i + 1}
              title={entry.title}
              progress={entry.progress}
              isRequired={entry.franchiseTitle.is_required}
              isCurrent={entry.title.title_id === title_id}
              onPress={() => handleEntryPress(entry.title.title_id)}
            />
            {i < entries.length - 1 && <View style={styles.divider} />}
          </React.Fragment>
        ))}
      </Panel>

      {/* Info note */}
      <Panel>
        <Text style={styles.infoNote}>
          Tap any title to open its tracker.{'\n'}
          Optional titles are safe to skip — they won't affect the main story.{'\n'}
          Watch order comes from community recommendations, not release dates.
        </Text>
      </Panel>
    </ScrollView>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.void },
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  loading: { flex: 1, backgroundColor: Colors.void, alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
  loadingText: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.gold },

  franchiseName: {
    fontFamily: Fonts.display, fontSize: FontSizes.displayMd,
    color: Colors.cream, marginBottom: Spacing.xs, lineHeight: 24,
  },
  franchiseDesc: {
    fontFamily: Fonts.body, fontSize: FontSizes.bodyMd,
    color: Colors.dim, marginBottom: Spacing.sm, lineHeight: 24,
  },
  progressBarWrap: {
    height: 6, backgroundColor: Colors.panelDeep,
    borderWidth: 1, borderColor: Colors.borderMid,
    marginVertical: Spacing.sm, overflow: 'hidden',
  },
  progressBarFill: { height: '100%', backgroundColor: Colors.mint },
  progressLabel: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.mint },

  legend: {
    flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  legendItem: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.dim },

  orderNote: {
    fontFamily: Fonts.display, fontSize: 7,
    color: Colors.borderMid, marginBottom: Spacing.md, letterSpacing: 1,
  },

  // Entry row
  entryRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: Spacing.sm, gap: Spacing.sm,
  },
  entryRowCurrent: {
    backgroundColor: Colors.panelDeep,
    marginHorizontal: -Spacing.md, paddingHorizontal: Spacing.md,
  },
  entryRowOptional: { opacity: 0.55 },

  entryPos: {
    fontFamily: Fonts.display, fontSize: FontSizes.displayXs,
    color: Colors.dim, width: 20, textAlign: 'right',
  },
  entryCover: { width: 36, height: 50 },
  entryCoverImg: { width: 36, height: 50, borderWidth: 1, borderColor: Colors.borderMid },
  entryText: { flex: 1 },
  entryTitle: {
    fontFamily: Fonts.body, fontSize: FontSizes.bodyMd,
    color: Colors.cream, lineHeight: 22, marginBottom: 4,
  },
  entryMeta: { flexDirection: 'row', gap: Spacing.xs, flexWrap: 'wrap' },
  formatTag: {
    borderWidth: 1, borderColor: Colors.borderMid,
    paddingHorizontal: 4, paddingVertical: 1,
  },
  formatTagText: { fontFamily: Fonts.display, fontSize: 7, color: Colors.dim },
  epCount: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.dim, alignSelf: 'center' },

  entryStatus: { alignItems: 'center', width: 52 },
  statusIcon: { fontFamily: Fonts.body, fontSize: 22, lineHeight: 22 },
  statusLabel: { fontFamily: Fonts.display, fontSize: 7, letterSpacing: 0.5, textAlign: 'center', lineHeight: 12 },

  entryArrow: { fontFamily: Fonts.body, fontSize: 28, color: Colors.borderMid },

  divider: { height: 1, backgroundColor: Colors.borderMid, marginVertical: 2 },

  emptyText: {
    fontFamily: Fonts.body, fontSize: FontSizes.bodyMd,
    color: Colors.dim, lineHeight: 26, marginBottom: Spacing.md,
  },
  infoNote: {
    fontFamily: Fonts.body, fontSize: FontSizes.bodyMd,
    color: Colors.dim, lineHeight: 26,
  },
});
