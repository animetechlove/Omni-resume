// ─────────────────────────────────────────────────────────────────────────────
// src/screens/TrophiesScreen.tsx
// Completion cards (§13.5) — one pixel-art "quest complete" card per
// finished viewing pass. User-exported only, never auto-posted. §0
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Image, Alert, FlatList,
} from 'react-native';
import ViewShot from 'react-native-view-shot';
import Share from 'react-native-share';
import { useNavigation } from '@react-navigation/native';
import { Colors, Fonts, FontSizes, Spacing, bevelBorder } from '../theme/pixelTheme';
import { Panel, PixelButton } from '../components/PixelUI';
import type { CompletionEvent, Title } from '../types';
import { getCompletionEvents, getTitleById } from '../db/dao/TitleDAO';
import { query } from '../db/database';

interface TrophyEntry {
  event: CompletionEvent;
  title: Title;
}

// ─── COMPLETION CARD ─────────────────────────────────────────────────────────

const cardRef = React.createRef<ViewShot>();

interface CompletionCardProps {
  entry: TrophyEntry;
  onShare: (titleId: string, pass: number) => void;
  onPress: () => void;
}

function CompletionCard({ entry, onShare, onPress }: CompletionCardProps) {
  const { event, title } = entry;

  const totalHours = Math.floor(event.total_watch_time_ms / (1000 * 60 * 60));
  const totalMins  = Math.floor((event.total_watch_time_ms % (1000 * 60 * 60)) / (1000 * 60));
  const dateStr    = new Date(event.completed_at).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const isRewatch  = event.viewing_pass > 1;

  return (
    <TouchableOpacity onPress={onPress} style={styles.cardWrap}>
      <View style={styles.card}>
        {/* Pixel border chrome */}
        <View style={styles.cardInner}>
          {/* Header */}
          <View style={styles.cardHeader}>
            <Text style={styles.questComplete}>
              {isRewatch ? `✓ REWATCH ${event.viewing_pass}` : '✓ QUEST COMPLETE'}
            </Text>
          </View>

          {/* Cover + title */}
          <View style={styles.cardBody}>
            {title.cover_image_url ? (
              <Image source={{ uri: title.cover_image_url }} style={styles.cardCover} />
            ) : (
              <View style={[styles.cardCover, { backgroundColor: Colors.panelDeep }]} />
            )}
            <View style={styles.cardMeta}>
              <Text style={styles.cardTitleText} numberOfLines={3}>
                {title.english_title ?? title.romaji_title}
              </Text>
              <View style={styles.cardStats}>
                <Text style={styles.cardStat}>📺 {event.episodes_count} EPISODES</Text>
                <Text style={styles.cardStat}>
                  ⏱ {totalHours > 0 ? `${totalHours}H ` : ''}{totalMins}M WATCHED
                </Text>
                <Text style={styles.cardStat}>📅 {dateStr}</Text>
              </View>
            </View>
          </View>

          {/* Footer */}
          <View style={styles.cardFooter}>
            <Text style={styles.cardFooterText}>OMNI-RESUME · ANIME QUEST TRACKER</Text>
          </View>
        </View>
      </View>

      {/* Share button */}
      <TouchableOpacity
        style={styles.shareBtn}
        onPress={() => onShare(title.title_id, event.viewing_pass)}
      >
        <Text style={styles.shareBtnText}>⬆ SHARE CARD</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ─── MAIN SCREEN ─────────────────────────────────────────────────────────────

export default function TrophiesScreen() {
  const navigation = useNavigation<any>();
  const [trophies, setTrophies] = useState<TrophyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const shotRef = useRef<ViewShot>(null);

  const load = useCallback(async () => {
    // Get all completion events across all titles
    const rows = await query<CompletionEvent & {
      romaji_title: string;
      english_title?: string;
      cover_image_url?: string;
      media_format?: string;
      total_episodes?: number;
      anilist_id?: number;
      updated_at_title: number;
    }>(
      `SELECT ce.*, t.romaji_title, t.english_title, t.cover_image_url,
         t.media_format, t.total_episodes, t.anilist_id,
         t.updated_at as updated_at_title
       FROM completion_event ce
       JOIN title t ON t.title_id = ce.title_id
       ORDER BY ce.completed_at DESC`,
    );

    const entries: TrophyEntry[] = rows.map(row => ({
      event: {
        completion_event_id: row.completion_event_id,
        title_id:            row.title_id,
        viewing_pass:        row.viewing_pass,
        completed_at:        row.completed_at,
        episodes_count:      row.episodes_count,
        total_watch_time_ms: row.total_watch_time_ms,
      },
      title: {
        title_id:        row.title_id,
        anilist_id:      row.anilist_id,
        romaji_title:    row.romaji_title,
        english_title:   row.english_title,
        cover_image_url: row.cover_image_url,
        media_format:    row.media_format as any,
        total_episodes:  row.total_episodes,
        updated_at:      row.updated_at_title,
      },
    }));

    setTrophies(entries);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleShare = async (titleId: string, pass: number) => {
    try {
      const uri = await shotRef.current?.capture?.();
      if (!uri) {
        Alert.alert('Could not capture card', 'Try again.');
        return;
      }
      await Share.open({
        url: `file://${uri}`,
        type: 'image/png',
        title: 'Anime Quest Complete',
      });
    } catch (e) {
      // User cancelled share — fine
    }
  };

  // Total stats
  const totalEps   = trophies.reduce((s, t) => s + t.event.episodes_count, 0);
  const totalMs    = trophies.reduce((s, t) => s + t.event.total_watch_time_ms, 0);
  const totalHours = Math.floor(totalMs / (1000 * 60 * 60));

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>

      {/* Overall stats banner */}
      <Panel label="QUEST LOG STATS">
        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{trophies.length}</Text>
            <Text style={styles.statLabel}>TITLES{'\n'}FINISHED</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statNum}>{totalEps}</Text>
            <Text style={styles.statLabel}>EPISODES{'\n'}WATCHED</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statNum}>{totalHours}h</Text>
            <Text style={styles.statLabel}>TOTAL{'\n'}WATCH TIME</Text>
          </View>
        </View>
      </Panel>

      {/* Cards */}
      {loading && (
        <Panel><Text style={styles.loadingText}>LOADING TROPHIES...</Text></Panel>
      )}

      {!loading && trophies.length === 0 && (
        <Panel label="NO TROPHIES YET">
          <Text style={styles.emptyText}>
            Finish your first anime to earn a completion card here.{'\n'}
            Each title you complete — and every rewatch — gets its own card.
          </Text>
          <PixelButton
            label="+ ADD ANIME"
            onPress={() => navigation.navigate('Search')}
            color={Colors.gold}
            style={{ marginTop: Spacing.md }}
          />
        </Panel>
      )}

      <ViewShot ref={shotRef} options={{ format: 'png', quality: 1 }}>
        {trophies.map(entry => (
          <CompletionCard
            key={`${entry.event.title_id}-${entry.event.viewing_pass}`}
            entry={entry}
            onShare={handleShare}
            onPress={() => navigation.navigate('Tracker', { title_id: entry.title.title_id })}
          />
        ))}
      </ViewShot>

    </ScrollView>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.void },
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },

  statsRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: Spacing.sm },
  stat: { alignItems: 'center', flex: 1 },
  statNum: { fontFamily: Fonts.display, fontSize: FontSizes.displayLg, color: Colors.gold },
  statLabel: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.dim, textAlign: 'center', lineHeight: 18, marginTop: 4 },
  statDivider: { width: 1, backgroundColor: Colors.borderMid },

  loadingText: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.dim },
  emptyText: { fontFamily: Fonts.body, fontSize: FontSizes.bodyMd, color: Colors.dim, lineHeight: 24 },

  cardWrap: { marginBottom: Spacing.lg },
  card: {
    backgroundColor: Colors.panel,
    borderWidth: 4, borderTopColor: Colors.borderHi, borderLeftColor: Colors.borderHi,
    borderBottomColor: Colors.borderMid, borderRightColor: Colors.borderMid,
    shadowColor: Colors.borderLo, shadowOffset: { width: 6, height: 6 },
    shadowOpacity: 1, shadowRadius: 0, elevation: 6,
  },
  cardInner: { padding: Spacing.md },
  cardHeader: {
    backgroundColor: Colors.gold, marginBottom: Spacing.sm,
    padding: Spacing.xs, alignItems: 'center',
    marginHorizontal: -Spacing.md, marginTop: -Spacing.md,
  },
  questComplete: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.void, letterSpacing: 1 },
  cardBody: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.sm },
  cardCover: { width: 72, height: 100, borderWidth: 2, borderColor: Colors.borderMid },
  cardMeta: { flex: 1 },
  cardTitleText: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.cream, lineHeight: 18, marginBottom: Spacing.sm },
  cardStats: { gap: 4 },
  cardStat: { fontFamily: Fonts.body, fontSize: FontSizes.bodyMd, color: Colors.dim },
  cardFooter: { borderTopWidth: 1, borderTopColor: Colors.borderMid, paddingTop: Spacing.xs, alignItems: 'center' },
  cardFooterText: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.borderMid, letterSpacing: 2 },

  shareBtn: {
    backgroundColor: Colors.panelDeep, borderWidth: 2,
    borderTopColor: Colors.borderMid, borderLeftColor: Colors.borderMid,
    borderBottomColor: Colors.borderLo, borderRightColor: Colors.borderLo,
    paddingVertical: Spacing.sm, alignItems: 'center', marginTop: 2,
  },
  shareBtnText: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.dim, letterSpacing: 1 },
});
