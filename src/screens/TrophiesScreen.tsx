import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Image, Alert, Share } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Colors, Fonts, FontSizes, Spacing, bevelBorder } from '../theme/pixelTheme';
import { Panel, PixelButton } from '../components/PixelUI';
import type { CompletionEvent, Title } from '../types';
import { query } from '../db/database';

interface TrophyEntry { event: CompletionEvent; title: Title; }

export default function TrophiesScreen() {
  const navigation = useNavigation<any>();
  const [trophies, setTrophies] = useState<TrophyEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const rows = await query<CompletionEvent & {
      romaji_title: string; english_title?: string; cover_image_url?: string;
      media_format?: string; total_episodes?: number; anilist_id?: number; updated_at_title: number;
    }>(
      `SELECT ce.*, t.romaji_title, t.english_title, t.cover_image_url,
         t.media_format, t.total_episodes, t.anilist_id, t.updated_at as updated_at_title
       FROM completion_event ce
       JOIN title t ON t.title_id = ce.title_id
       ORDER BY ce.completed_at DESC`,
    );
    setTrophies(rows.map(row => ({
      event: {
        completion_event_id: row.completion_event_id,
        title_id: row.title_id,
        viewing_pass: row.viewing_pass,
        completed_at: row.completed_at,
        episodes_count: row.episodes_count,
        total_watch_time_ms: row.total_watch_time_ms,
      },
      title: {
        title_id: row.title_id,
        anilist_id: row.anilist_id,
        romaji_title: row.romaji_title,
        english_title: row.english_title,
        cover_image_url: row.cover_image_url,
        media_format: row.media_format as any,
        total_episodes: row.total_episodes,
        updated_at: row.updated_at_title,
      },
    })));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleShare = async (entry: TrophyEntry) => {
    const h = Math.floor(entry.event.total_watch_time_ms / (1000 * 60 * 60));
    const m = Math.floor((entry.event.total_watch_time_ms % (1000 * 60 * 60)) / (1000 * 60));
    const date = new Date(entry.event.completed_at).toLocaleDateString();
    try {
      await Share.share({
        message: `I just finished ${entry.title.english_title ?? entry.title.romaji_title}!\n${entry.event.episodes_count} episodes · ${h}h ${m}m · ${date}\n\n#AnimeQuest #OmniResume`,
      });
    } catch {}
  };

  const totalEps = trophies.reduce((s, t) => s + t.event.episodes_count, 0);
  const totalHours = Math.floor(trophies.reduce((s, t) => s + t.event.total_watch_time_ms, 0) / (1000 * 60 * 60));

  return (
    <ScrollView style={s.root} contentContainerStyle={s.container}>
      <Panel label="QUEST LOG STATS">
        <View style={s.statsRow}>
          <View style={s.stat}><Text style={s.statNum}>{trophies.length}</Text><Text style={s.statLabel}>TITLES{'\n'}FINISHED</Text></View>
          <View style={s.divider} />
          <View style={s.stat}><Text style={s.statNum}>{totalEps}</Text><Text style={s.statLabel}>EPISODES{'\n'}WATCHED</Text></View>
          <View style={s.divider} />
          <View style={s.stat}><Text style={s.statNum}>{totalHours}h</Text><Text style={s.statLabel}>TOTAL{'\n'}WATCH TIME</Text></View>
        </View>
      </Panel>
      {loading && <Panel><Text style={s.loading}>LOADING TROPHIES...</Text></Panel>}
      {!loading && trophies.length === 0 && (
        <Panel label="NO TROPHIES YET">
          <Text style={s.empty}>Finish your first anime to earn a completion card.</Text>
          <PixelButton label="+ ADD ANIME" onPress={() => navigation.navigate('Search')} color={Colors.gold} style={{ marginTop: 12 }} />
        </Panel>
      )}
      {trophies.map(entry => {
        const h = Math.floor(entry.event.total_watch_time_ms / (1000 * 60 * 60));
        const m = Math.floor((entry.event.total_watch_time_ms % (1000 * 60 * 60)) / (1000 * 60));
        const date = new Date(entry.event.completed_at).toLocaleDateString();
        return (
          <View key={entry.event.completion_event_id} style={s.card}>
            <View style={s.cardInner}>
              <View style={s.cardHeader}>
                <Text style={s.questComplete}>{entry.event.viewing_pass > 1 ? `REWATCH ${entry.event.viewing_pass}` : 'QUEST COMPLETE'}</Text>
              </View>
              <View style={s.cardBody}>
                {entry.title.cover_image_url
                  ? <Image source={{ uri: entry.title.cover_image_url }} style={s.cover} />
                  : <View style={[s.cover, { backgroundColor: Colors.panelDeep }]} />}
                <View style={s.cardMeta}>
                  <Text style={s.cardTitle} numberOfLines={3}>{entry.title.english_title ?? entry.title.romaji_title}</Text>
                  <Text style={s.cardStat}>📺 {entry.event.episodes_count} EPISODES</Text>
                  <Text style={s.cardStat}>⏱ {h > 0 ? `${h}H ` : ''}{m}M WATCHED</Text>
                  <Text style={s.cardStat}>📅 {date}</Text>
                </View>
              </View>
              <View style={s.cardFooter}>
                <Text style={s.footerText}>OMNI-RESUME · ANIME QUEST TRACKER</Text>
              </View>
            </View>
            <TouchableOpacity style={s.shareBtn} onPress={() => handleShare(entry)}>
              <Text style={s.shareBtnText}>⬆ SHARE CARD</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.void },
  container: { padding: 18, paddingBottom: 64 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 8 },
  stat: { alignItems: 'center', flex: 1 },
  statNum: { fontFamily: Fonts.display, fontSize: FontSizes.displayLg, color: Colors.gold },
  statLabel: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.dim, textAlign: 'center', lineHeight: 18, marginTop: 4 },
  divider: { width: 1, backgroundColor: Colors.borderMid },
  loading: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.dim },
  empty: { fontFamily: Fonts.body, fontSize: FontSizes.bodyMd, color: Colors.dim, lineHeight: 24 },
  card: { marginBottom: 18 },
  cardInner: { backgroundColor: Colors.panel, borderWidth: 4, borderTopColor: Colors.borderHi, borderLeftColor: Colors.borderHi, borderBottomColor: Colors.borderMid, borderRightColor: Colors.borderMid, padding: 14 },
  cardHeader: { backgroundColor: Colors.gold, marginBottom: 8, padding: 6, alignItems: 'center', marginHorizontal: -14, marginTop: -14 },
  questComplete: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.void, letterSpacing: 1 },
  cardBody: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  cover: { width: 72, height: 100, borderWidth: 2, borderColor: Colors.borderMid },
  cardMeta: { flex: 1 },
  cardTitle: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.cream, lineHeight: 18, marginBottom: 8 },
  cardStat: { fontFamily: Fonts.body, fontSize: FontSizes.bodyMd, color: Colors.dim },
  cardFooter: { borderTopWidth: 1, borderTopColor: Colors.borderMid, paddingTop: 6, alignItems: 'center' },
  footerText: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.borderMid, letterSpacing: 2 },
  shareBtn: { backgroundColor: Colors.panelDeep, borderWidth: 2, borderTopColor: Colors.borderMid, borderLeftColor: Colors.borderMid, borderBottomColor: Colors.borderLo, borderRightColor: Colors.borderLo, paddingVertical: 8, alignItems: 'center', marginTop: 2 },
  shareBtnText: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.dim, letterSpacing: 1 },
});
