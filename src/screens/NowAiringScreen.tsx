// ─────────────────────────────────────────────────────────────────────────────
// src/screens/NowAiringScreen.tsx
// Upcoming episode schedule for every tracked title (§13.4).
// Data comes from the airing_schedule table, fed by the same server poll
// that sends episode-drop push notifications (§12.2 / §13.4).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Image,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Colors, Fonts, FontSizes, Spacing } from '../theme/pixelTheme';
import { Panel, PixelButton } from '../components/PixelUI';
import type { Title, AiringSchedule } from '../types';
import { getUpcomingEpisodes } from '../db/dao/TitleDAO';

// ─── TIME HELPERS ─────────────────────────────────────────────────────────────

function groupLabel(airsAt: number): string {
  const now = Date.now();
  const diff = airsAt - now;
  const hours = diff / (1000 * 60 * 60);
  const days  = diff / (1000 * 60 * 60 * 24);

  if (diff < 0)          return 'OVERDUE';
  if (hours < 24)        return 'TODAY';
  if (hours < 48)        return 'TOMORROW';
  if (days < 7)          return 'THIS WEEK';
  if (days < 14)         return 'NEXT WEEK';
  return 'LATER';
}

const GROUP_ORDER = ['TODAY', 'TOMORROW', 'THIS WEEK', 'NEXT WEEK', 'LATER', 'OVERDUE'];
const GROUP_COLORS: Record<string, string> = {
  TODAY:      Colors.mint,
  TOMORROW:   Colors.gold,
  'THIS WEEK':Colors.cream,
  'NEXT WEEK':Colors.dim,
  LATER:      Colors.borderMid,
  OVERDUE:    Colors.coral,
};

function formatAirTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function countdown(ms: number): string {
  const diff = ms - Date.now();
  if (diff < 0) return 'aired';
  const h = Math.floor(diff / (1000 * 60 * 60));
  const d = Math.floor(h / 24);
  if (d > 0) return `in ${d}d ${h % 24}h`;
  const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

// ─── AIRING CARD ─────────────────────────────────────────────────────────────

interface AiringCardProps {
  schedule: AiringSchedule & { title: Title };
  onPress: () => void;
}

function AiringCard({ schedule, onPress }: AiringCardProps) {
  const { title } = schedule;
  const hasTime = !!schedule.airs_at;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress}>
      <View style={styles.cardCover}>
        {title.cover_image_url ? (
          <Image source={{ uri: title.cover_image_url }} style={styles.cardImg} />
        ) : (
          <View style={[styles.cardImg, { backgroundColor: Colors.panelDeep, alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.borderMid }}>?</Text>
          </View>
        )}
      </View>

      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {title.english_title ?? title.romaji_title}
        </Text>
        {schedule.next_absolute_number && (
          <Text style={styles.cardEp}>
            EPISODE {schedule.next_absolute_number}
          </Text>
        )}
        {hasTime ? (
          <>
            <Text style={styles.cardTime}>{formatAirTime(schedule.airs_at!)}</Text>
            <Text style={styles.cardCountdown}>{countdown(schedule.airs_at!)}</Text>
          </>
        ) : (
          <Text style={styles.cardTime}>Airing date TBA</Text>
        )}
      </View>

      <Text style={styles.cardArrow}>›</Text>
    </TouchableOpacity>
  );
}

// ─── MAIN SCREEN ─────────────────────────────────────────────────────────────

export default function NowAiringScreen() {
  const navigation = useNavigation<any>();
  const [grouped, setGrouped] = useState<
    Map<string, Array<AiringSchedule & { title: Title }>>
  >(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const upcoming = await getUpcomingEpisodes();

    const map = new Map<string, Array<AiringSchedule & { title: Title }>>();
    for (const item of upcoming) {
      const group = item.airs_at ? groupLabel(item.airs_at) : 'LATER';
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(item as any);
    }
    setGrouped(map);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const isEmpty = grouped.size === 0;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.gold} />
      }
    >
      <Text style={styles.heading}>NOW AIRING</Text>
      <Text style={styles.subheading}>
        Pull down to refresh · Episodes from your tracked titles
      </Text>

      {loading && (
        <Panel>
          <Text style={styles.loadingText}>SCANNING SCHEDULE...</Text>
        </Panel>
      )}

      {!loading && isEmpty && (
        <Panel label="NO UPCOMING EPISODES">
          <Text style={styles.emptyText}>
            No airing data yet. Add shows to your library and the schedule
            will appear here once the server syncs.
          </Text>
          <PixelButton
            label="+ ADD ANIME"
            onPress={() => navigation.navigate('Search')}
            color={Colors.gold}
            style={{ marginTop: Spacing.md }}
          />
        </Panel>
      )}

      {GROUP_ORDER.filter(g => grouped.has(g)).map(group => (
        <View key={group} style={styles.group}>
          <View style={[styles.groupHeader, { borderLeftColor: GROUP_COLORS[group] }]}>
            <Text style={[styles.groupLabel, { color: GROUP_COLORS[group] }]}>
              {group}
            </Text>
          </View>
          {(grouped.get(group) ?? []).map(item => (
            <AiringCard
              key={item.title_id}
              schedule={item}
              onPress={() => navigation.navigate('Tracker', { title_id: item.title_id })}
            />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.void },
  container: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  heading: { fontFamily: Fonts.display, fontSize: FontSizes.displayMd, color: Colors.gold, marginBottom: 4 },
  subheading: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.dim, marginBottom: Spacing.lg },
  loadingText: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.dim },
  emptyText: { fontFamily: Fonts.body, fontSize: FontSizes.bodyMd, color: Colors.dim, lineHeight: 24 },

  group: { marginBottom: Spacing.lg },
  groupHeader: { borderLeftWidth: 3, paddingLeft: Spacing.sm, marginBottom: Spacing.sm },
  groupLabel: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, letterSpacing: 1 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.borderMid,
  },
  cardCover: { flexShrink: 0 },
  cardImg: { width: 44, height: 60, borderWidth: 1, borderColor: Colors.borderMid },
  cardInfo: { flex: 1 },
  cardTitle: { fontFamily: Fonts.body, fontSize: FontSizes.bodyLg, color: Colors.cream, lineHeight: 22, marginBottom: 2 },
  cardEp: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.gold, marginBottom: 2 },
  cardTime: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.dim },
  cardCountdown: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.mint, marginTop: 2 },
  cardArrow: { fontFamily: Fonts.body, fontSize: 28, color: Colors.borderMid },
});
