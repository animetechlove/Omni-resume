// ─────────────────────────────────────────────────────────────────────────────
// src/screens/LibraryScreen.tsx
// Full library view. Three shelf tabs (Active / Snoozed / Archived).
// Mood/vibe tag filter (§13.6). Backlog decay warnings (§13.2).
// Tap any title → TrackerScreen.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Image, TextInput, FlatList,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Colors, Fonts, FontSizes, Spacing, bevelBorder, StatusColors } from '../theme/pixelTheme';
import { Panel, PixelButton, WatchStatusPill } from '../components/PixelUI';
import type { Progress, Title, ShelfStatus, WatchStatus } from '../types';
import { getAllTags, getTitlesByTag } from '../db/dao/TitleDAO';
import { execute } from '../db/database';
import { getAllActiveProgress, getDecayingTitles } from '../db/dao/ProgressDAO';
import { query } from '../db/database';

type ShelfTab = 'ACTIVE' | 'SNOOZED' | 'ARCHIVED';

interface LibraryEntry {
  progress: Progress;
  title: Title;
  watched_count: number;
  is_decaying: boolean;
}

// ─── LOAD LIBRARY DATA ───────────────────────────────────────────────────────

async function loadLibraryEntries(
  shelf: ShelfTab,
  tagFilter: string[],
): Promise<LibraryEntry[]> {
  const rows = await query<
    Progress & {
      romaji_title: string;
      english_title?: string;
      cover_image_url?: string;
      total_episodes?: number;
      media_format?: string;
      updated_at_title: number;
      anilist_id?: number;
      mal_id?: number;
      tmdb_id?: number;
    }
  >(
    `SELECT p.*,
       t.romaji_title, t.english_title, t.cover_image_url,
       t.total_episodes, t.media_format, t.updated_at as updated_at_title,
       t.anilist_id, t.mal_id, t.tmdb_id
     FROM progress p
     JOIN title t ON t.title_id = p.title_id
     WHERE p.shelf_status = ?
     ORDER BY p.updated_at DESC`,
    [shelf],
  );

  const decayingIds = new Set(
    (await getDecayingTitles(30)).map(p => p.title_id),
  );

  let entries: LibraryEntry[] = rows.map(row => ({
    progress: {
      progress_id:          row.progress_id,
      title_id:             row.title_id,
      watch_episode_id:     row.watch_episode_id,
      watch_timestamp_ms:   row.watch_timestamp_ms,
      watch_status:         row.watch_status,
      last_platform_id:     row.last_platform_id,
      provenance:           row.provenance,
      play_status:          row.play_status,
      play_save_ref:        row.play_save_ref,
      unlocked_arc_index:   row.unlocked_arc_index,
      active_mode:          row.active_mode,
      viewing_pass:         row.viewing_pass,
      shelf_status:         row.shelf_status,
      last_decay_prompt_at: row.last_decay_prompt_at,
      updated_at:           row.updated_at,
    },
    title: {
      title_id:        row.title_id,
      anilist_id:      row.anilist_id,
      mal_id:          row.mal_id,
      tmdb_id:         row.tmdb_id,
      romaji_title:    row.romaji_title,
      english_title:   row.english_title,
      cover_image_url: row.cover_image_url,
      total_episodes:  row.total_episodes,
      media_format:    row.media_format as any,
      updated_at:      row.updated_at_title,
    },
    watched_count: 0, // simplified — episode count would need a subquery
    is_decaying:   decayingIds.has(row.title_id),
  }));

  // Apply tag filter if any selected
  if (tagFilter.length > 0) {
    const taggedTitles = await getTitlesByTag(tagFilter);
    const taggedIds = new Set(taggedTitles.map(t => t.title_id));
    entries = entries.filter(e => taggedIds.has(e.title.title_id));
  }

  return entries;
}

// ─── TITLE CARD ──────────────────────────────────────────────────────────────

interface TitleCardProps {
  entry: LibraryEntry;
  onPress: () => void;
  onRemove: () => void;
}

function TitleCard({ entry, onPress, onRemove }: TitleCardProps) {
  const { title, progress, is_decaying } = entry;
  const statusCfg = StatusColors[progress.watch_status] ?? StatusColors.DISCOVERED;
  const [removing, setRemoving] = React.useState(false);

  const daysSince = Math.floor(
    (Date.now() - progress.updated_at) / (1000 * 60 * 60 * 24),
  );

  const handleRemovePress = () => {
    setRemoving(true);
    onRemove();
  };

  return (
    <View style={[styles.card, is_decaying && styles.cardDecaying]}>
      {/* Cover — tappable to open tracker */}
      <TouchableOpacity onPress={onPress} style={styles.cardCover}>
        {title.cover_image_url ? (
          <Image source={{ uri: title.cover_image_url }} style={styles.cardCoverImg} />
        ) : (
          <View style={[styles.cardCoverImg, { backgroundColor: Colors.panelDeep }]}>
            <Text style={styles.cardCoverPlaceholder}>?</Text>
          </View>
        )}
        {progress.viewing_pass > 1 && (
          <View style={styles.passBadge}>
            <Text style={styles.passBadgeText}>×{progress.viewing_pass}</Text>
          </View>
        )}
      </TouchableOpacity>

      {/* Info — tappable to open tracker */}
      <TouchableOpacity style={styles.cardInfo} onPress={onPress}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {title.english_title ?? title.romaji_title}
        </Text>
        <View style={styles.cardMeta}>
          {title.media_format && (
            <Text style={styles.cardFormat}>{title.media_format}</Text>
          )}
          {title.total_episodes && (
            <Text style={styles.cardFormat}> · {title.total_episodes} EP</Text>
          )}
        </View>
        <View style={[styles.statusPill, { backgroundColor: statusCfg.bg }]}>
          <Text style={[styles.statusPillText, { color: statusCfg.text }]}>
            {statusCfg.label}
          </Text>
        </View>
        {is_decaying && (
          <Text style={styles.decayWarning}>⚠ No activity for {daysSince} days</Text>
        )}
      </TouchableOpacity>

      {/* Slide toggle remove button */}
      <TouchableOpacity
        style={[
          styles.removeBtn,
          { backgroundColor: removing ? Colors.borderMid : Colors.coral }
        ]}
        onPress={handleRemovePress}
        disabled={removing}
        activeOpacity={0.7}
      >
        <View style={[styles.slideIndicator, removing ? styles.slideOff : styles.slideOn]} />
        <Text style={styles.removeBtnText}>
          {removing ? 'REMOVING' : 'REMOVE'}{'
'}{removing ? '...' : '✕'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── TAG FILTER ──────────────────────────────────────────────────────────────

interface TagFilterProps {
  tags: string[];
  selected: string[];
  onToggle: (tag: string) => void;
}

function TagFilter({ tags, selected, onToggle }: TagFilterProps) {
  if (tags.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.tagScroll}
      contentContainerStyle={styles.tagRow}
    >
      {tags.slice(0, 20).map(tag => {
        const active = selected.includes(tag);
        return (
          <TouchableOpacity
            key={tag}
            style={[styles.tag, active && styles.tagActive]}
            onPress={() => onToggle(tag)}
          >
            <Text style={[styles.tagText, active && styles.tagTextActive]}>
              {tag}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// ─── MAIN SCREEN ─────────────────────────────────────────────────────────────

export default function LibraryScreen() {
  const navigation = useNavigation<any>();
  const [activeTab, setActiveTab] = useState<ShelfTab>('ACTIVE');
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [e, tags] = await Promise.all([
      loadLibraryEntries(activeTab, selectedTags),
      getAllTags(),
    ]);
    setEntries(e);
    setAllTags(tags);
    setLoading(false);
  }, [activeTab, selectedTags]);

  useEffect(() => { load(); }, [load]);

  const handleRemove = async (titleId: string, titleName: string) => {
    Alert.alert(
      'Remove title?',
      `Remove ${titleName} from your library? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await execute(`DELETE FROM progress WHERE title_id = ?`, [titleId]);
            await load();
          },
        },
      ],
    );
  };

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag],
    );
  };

  const TABS: { key: ShelfTab; label: string }[] = [
    { key: 'ACTIVE',   label: 'ACTIVE'   },
    { key: 'SNOOZED',  label: 'SNOOZED'  },
    { key: 'ARCHIVED', label: 'ARCHIVED' },
  ];

  const counts = {
    ACTIVE:   entries.filter(e => e.progress.shelf_status === 'ACTIVE').length,
    SNOOZED:  entries.filter(e => e.progress.shelf_status === 'SNOOZED').length,
    ARCHIVED: entries.filter(e => e.progress.shelf_status === 'ARCHIVED').length,
  };

  return (
    <View style={styles.root}>
      {/* Shelf tabs */}
      <View style={styles.tabs}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab.key }}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Vibe / mood tag filter (§13.6) */}
      <TagFilter
        tags={allTags}
        selected={selectedTags}
        onToggle={toggleTag}
      />
      {selectedTags.length > 0 && (
        <TouchableOpacity
          style={styles.clearTags}
          onPress={() => setSelectedTags([])}
        >
          <Text style={styles.clearTagsText}>✕ Clear filter</Text>
        </TouchableOpacity>
      )}

      {/* Entry list */}
      <FlatList
        data={entries}
        keyExtractor={e => e.title.title_id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyText}>
              {loading ? 'LOADING...' : 'Nothing here yet.'}
            </Text>
            {activeTab === 'ACTIVE' && !loading && (
              <PixelButton
                label="+ ADD ANIME"
                onPress={() => navigation.navigate('Search')}
                color={Colors.gold}
                style={{ marginTop: Spacing.md }}
              />
            )}
          </View>
        }
        renderItem={({ item }) => (
          <TitleCard
            entry={item}
            onPress={() =>
              navigation.navigate('Tracker', { title_id: item.title.title_id })
            }
            onRemove={() => handleRemove(
              item.title.title_id,
              item.title.english_title ?? item.title.romaji_title
            )}
          />
        )}
      />
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.void },
  tabs: { flexDirection: 'row', backgroundColor: Colors.panel, borderBottomWidth: 2, borderBottomColor: Colors.borderMid },
  tab: { flex: 1, paddingVertical: Spacing.sm, alignItems: 'center' },
  tabActive: { borderBottomWidth: 3, borderBottomColor: Colors.gold },
  tabText: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.dim, letterSpacing: 1 },
  tabTextActive: { color: Colors.gold },

  tagScroll: { maxHeight: 44, backgroundColor: Colors.panelDeep },
  tagRow: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, gap: Spacing.xs, flexDirection: 'row' },
  tag: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderWidth: 1, borderColor: Colors.borderMid },
  tagActive: { borderColor: Colors.gold, backgroundColor: Colors.panel },
  tagText: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.dim },
  tagTextActive: { color: Colors.gold },
  clearTags: { paddingHorizontal: Spacing.md, paddingVertical: 4, backgroundColor: Colors.panelDeep },
  clearTagsText: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.coral },

  list: { padding: Spacing.md, paddingBottom: Spacing.xxl },

  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.borderMid },
  cardDecaying: { backgroundColor: 'rgba(255,107,107,0.05)' },
  cardCover: { position: 'relative' },
  cardCoverImg: { width: 52, height: 72, borderWidth: 1, borderColor: Colors.borderMid, alignItems: 'center', justifyContent: 'center' },
  cardCoverPlaceholder: { fontFamily: Fonts.display, fontSize: FontSizes.displayMd, color: Colors.borderMid },
  passBadge: { position: 'absolute', bottom: 0, right: 0, backgroundColor: Colors.violet, paddingHorizontal: 3, paddingVertical: 1 },
  passBadgeText: { fontFamily: Fonts.display, fontSize: 7, color: Colors.void },

  cardInfo: { flex: 1 },
  cardTitle: { fontFamily: Fonts.body, fontSize: FontSizes.bodyLg, color: Colors.cream, lineHeight: 22, marginBottom: 3 },
  cardMeta: { flexDirection: 'row' },
  cardFormat: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.dim },
  statusPill: { alignSelf: 'flex-start', paddingHorizontal: Spacing.xs, paddingVertical: 2, marginTop: 4 },
  statusPillText: { fontFamily: Fonts.display, fontSize: 7, letterSpacing: 0.5 },
  decayWarning: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.coral, marginTop: 3 },
  cardArrow: { fontFamily: Fonts.body, fontSize: 28, color: Colors.borderMid },
  removeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderWidth: 2,
    borderColor: Colors.borderLo,
    marginLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 64,
    gap: 4,
  },
  slideIndicator: {
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.void,
  },
  slideOn: { alignSelf: 'flex-end' },
  slideOff: { alignSelf: 'flex-start' },
  removeBtnText: {
    fontFamily: Fonts.display,
    fontSize: 9,
    color: Colors.void,
    textAlign: 'center',
    lineHeight: 14,
  },

  empty: { alignItems: 'center', paddingTop: Spacing.xxl, gap: Spacing.sm },
  emptyIcon: { fontSize: 48 },
  emptyText: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.dim, textAlign: 'center' },
});
