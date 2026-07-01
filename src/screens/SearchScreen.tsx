// ─────────────────────────────────────────────────────────────────────────────
// src/screens/SearchScreen.tsx
// Search AniList for anime and add titles to the local tracker.
// Uses the searchTitles() function added to AniListClient (unauthenticated,
// no login required for basic search).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput, FlatList,
  TouchableOpacity, Image, Alert, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Colors, Fonts, FontSizes, Spacing } from '../theme/pixelTheme';
import { PixelButton, Panel } from '../components/PixelUI';
import type { AniListSearchResult } from '../services/AniListClient';
import { searchTitles } from '../services/AniListClient';
import { upsertTitle, upsertSeason, upsertEpisode, upsertTitleTags } from '../db/dao/TitleDAO';
import { getOrCreateProgress } from '../db/dao/ProgressDAO';
import { getProgress } from '../db/dao/ProgressDAO';
import { v4 as uuidv4 } from 'uuid';

// ─── ADD TITLE TO LOCAL DB ────────────────────────────────────────────────────

async function addTitleToLibrary(result: AniListSearchResult): Promise<string> {
  const titleId = uuidv4();
  const now = Date.now();

  // Upsert the title row
  await upsertTitle({
    title_id:        titleId,
    anilist_id:      result.anilist_id,
    mal_id:          result.mal_id,
    romaji_title:    result.romaji_title,
    english_title:   result.english_title,
    media_format:    result.media_format as any,
    total_episodes:  result.total_episodes,
    cover_image_url: result.cover_image_url,
    updated_at:      now,
  });

  // Create default season 1
  const seasonId = uuidv4();
  await upsertSeason({
    season_id:     seasonId,
    title_id:      titleId,
    season_number: 1,
    label:         undefined,
  });

  // Stub episode rows if we know the total count
  if (result.total_episodes && result.total_episodes > 0) {
    for (let n = 1; n <= result.total_episodes; n++) {
      await upsertEpisode({
        episode_id:      uuidv4(),
        title_id:        titleId,
        season_id:       seasonId,
        absolute_number: n,
        season_episode:  n,
        canonical_kind:  'MAIN',
      });
    }
  }

  // Store genre/mood tags (§13.6)
  if (result.tags.length > 0) {
    await upsertTitleTags(titleId, result.tags);
  }

  // Create progress row
  await getOrCreateProgress(titleId);

  return titleId;
}

// ─── SEARCH RESULT CARD ───────────────────────────────────────────────────────

interface ResultCardProps {
  result: AniListSearchResult;
  alreadyAdded: boolean;
  onAdd: () => void;
  onOpen: () => void;
}

function ResultCard({ result, alreadyAdded, onAdd, onOpen }: ResultCardProps) {
  const epLabel = result.total_episodes
    ? `${result.total_episodes} EP`
    : 'TBA';

  return (
    <View style={styles.resultCard}>
      {/* Cover */}
      <View style={styles.resultCover}>
        {result.cover_image_url ? (
          <Image source={{ uri: result.cover_image_url }} style={styles.resultImg} />
        ) : (
          <View style={[styles.resultImg, { backgroundColor: Colors.panelDeep, alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.borderMid }}>?</Text>
          </View>
        )}
      </View>

      {/* Info */}
      <View style={styles.resultInfo}>
        <Text style={styles.resultTitle} numberOfLines={2}>
          {result.english_title ?? result.romaji_title}
        </Text>
        {result.english_title && result.romaji_title !== result.english_title && (
          <Text style={styles.resultSubTitle} numberOfLines={1}>{result.romaji_title}</Text>
        )}
        <View style={styles.resultMeta}>
          {result.media_format && (
            <Text style={styles.resultMetaText}>{result.media_format}</Text>
          )}
          <Text style={styles.resultMetaText}> · {epLabel}</Text>
          {result.status && (
            <Text style={styles.resultMetaText}> · {result.status.replace('_', ' ')}</Text>
          )}
        </View>
        {result.next_episode && result.next_airing_at && (
          <Text style={styles.airingText}>
            EP {result.next_episode} →{' '}
            {new Date(result.next_airing_at).toLocaleDateString()}
          </Text>
        )}
      </View>

      {/* Action */}
      <View style={styles.resultAction}>
        {alreadyAdded ? (
          <TouchableOpacity style={styles.openBtn} onPress={onOpen}>
            <Text style={styles.openBtnText}>OPEN{'\n'}▶</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.addBtn} onPress={onAdd}>
            <Text style={styles.addBtnText}>ADD{'\n'}+</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── MAIN SCREEN ─────────────────────────────────────────────────────────────

export default function SearchScreen() {
  const navigation = useNavigation<any>();
  const [searchText, setSearchText] = useState('');
  const [results, setResults] = useState<AniListSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const doSearch = useCallback(async (text: string) => {
    if (text.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const r = await searchTitles(text.trim());
      setResults(r);
    } catch (e: any) {
      setError('Could not reach AniList. Check your connection.');
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleChangeText = (text: string) => {
    setSearchText(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(text), 500);
  };

  const handleAdd = async (result: AniListSearchResult) => {
    try {
      const titleId = await addTitleToLibrary(result);
      setAddedIds(prev => new Set(prev).add(result.anilist_id));
      Alert.alert(
        '✓ Added',
        `${result.english_title ?? result.romaji_title} added to your library.`,
        [
          { text: 'Open Tracker', onPress: () => navigation.navigate('Tracker', { title_id: titleId }) },
          { text: 'Keep Searching', style: 'cancel' },
        ],
      );
    } catch (e: any) {
      Alert.alert('Error', 'Could not add title: ' + (e.message ?? 'unknown error'));
    }
  };

  const handleOpen = async (result: AniListSearchResult) => {
    // Find the local title_id for this anilist_id
    const { getTitleByAnilistId } = await import('../db/dao/TitleDAO');
    const t = await getTitleByAnilistId(result.anilist_id);
    if (t) {
      navigation.navigate('Tracker', { title_id: t.title_id });
    }
  };

  return (
    <View style={styles.root}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <View style={styles.searchInput}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.input}
            placeholder="Search anime..."
            placeholderTextColor={Colors.dim}
            value={searchText}
            onChangeText={handleChangeText}
            autoFocus
            returnKeyType="search"
            onSubmitEditing={() => doSearch(searchText)}
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => { setSearchText(''); setResults([]); }}>
              <Text style={styles.clearIcon}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Powered by AniList note */}
      <Text style={styles.poweredBy}>Powered by AniList API</Text>

      {/* States */}
      {searching && (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.gold} />
          <Text style={styles.searchingText}>SEARCHING...</Text>
        </View>
      )}

      {error && (
        <Panel style={{ margin: Spacing.lg }}>
          <Text style={styles.errorText}>{error}</Text>
        </Panel>
      )}

      {!searching && !error && results.length === 0 && searchText.length > 1 && (
        <View style={styles.center}>
          <Text style={styles.noResults}>No results for "{searchText}"</Text>
        </View>
      )}

      {!searching && results.length === 0 && searchText.length < 2 && (
        <View style={styles.center}>
          <Text style={styles.hint}>▸ TYPE AT LEAST 2 CHARACTERS TO SEARCH</Text>
        </View>
      )}

      {/* Results list */}
      <FlatList
        data={results}
        keyExtractor={r => String(r.anilist_id)}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ResultCard
            result={item}
            alreadyAdded={addedIds.has(item.anilist_id)}
            onAdd={() => handleAdd(item)}
            onOpen={() => handleOpen(item)}
          />
        )}
      />
    </View>
  );
}

// ─── STYLES ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.void },

  searchBar: { padding: Spacing.md, backgroundColor: Colors.panel, borderBottomWidth: 2, borderBottomColor: Colors.borderMid },
  searchInput: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.panelDeep,
    borderWidth: 2, borderTopColor: Colors.borderMid, borderLeftColor: Colors.borderMid,
    borderBottomColor: Colors.borderLo, borderRightColor: Colors.borderLo,
    paddingHorizontal: Spacing.sm,
  },
  searchIcon: { fontSize: 18, marginRight: Spacing.xs },
  input: { flex: 1, fontFamily: Fonts.body, fontSize: FontSizes.bodyLg, color: Colors.cream, paddingVertical: Spacing.sm },
  clearIcon: { fontFamily: Fonts.body, fontSize: FontSizes.bodyLg, color: Colors.dim, padding: Spacing.xs },

  poweredBy: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.borderMid, textAlign: 'center', paddingVertical: 4, backgroundColor: Colors.panelDeep },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl },
  searchingText: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.gold, marginTop: Spacing.md },
  noResults: { fontFamily: Fonts.body, fontSize: FontSizes.bodyLg, color: Colors.dim, textAlign: 'center' },
  hint: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.borderMid, textAlign: 'center', letterSpacing: 1 },
  errorText: { fontFamily: Fonts.body, fontSize: FontSizes.bodyMd, color: Colors.coral },

  list: { padding: Spacing.md, paddingBottom: Spacing.xxl },

  resultCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.borderMid,
  },
  resultCover: {},
  resultImg: { width: 48, height: 68, borderWidth: 1, borderColor: Colors.borderMid },
  resultInfo: { flex: 1 },
  resultTitle: { fontFamily: Fonts.body, fontSize: FontSizes.bodyLg, color: Colors.cream, lineHeight: 22, marginBottom: 2 },
  resultSubTitle: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.dim, marginBottom: 2 },
  resultMeta: { flexDirection: 'row', flexWrap: 'wrap' },
  resultMetaText: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.dim },
  airingText: { fontFamily: Fonts.display, fontSize: 8, color: Colors.mint, marginTop: 3 },
  resultAction: {},
  addBtn: {
    backgroundColor: Colors.gold, borderWidth: 2, borderColor: Colors.borderLo,
    paddingVertical: 6, paddingHorizontal: Spacing.sm, alignItems: 'center', minWidth: 44,
  },
  addBtnText: { fontFamily: Fonts.display, fontSize: 9, color: Colors.void, textAlign: 'center', lineHeight: 14 },
  openBtn: {
    backgroundColor: Colors.mint, borderWidth: 2, borderColor: Colors.borderLo,
    paddingVertical: 6, paddingHorizontal: Spacing.sm, alignItems: 'center', minWidth: 44,
  },
  openBtnText: { fontFamily: Fonts.display, fontSize: 9, color: Colors.void, textAlign: 'center', lineHeight: 14 },
});
