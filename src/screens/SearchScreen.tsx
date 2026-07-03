import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput, FlatList,
  TouchableOpacity, Image, Alert, ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Colors, Fonts, FontSizes, Spacing } from '../theme/pixelTheme';
import { Panel, PixelButton } from '../components/PixelUI';
import type { AniListSearchResult } from '../services/AniListClient';
import { searchTitles } from '../services/AniListClient';
import { upsertTitle, upsertSeason, upsertEpisode, upsertTitleTags, getTitleByAnilistId } from '../db/dao/TitleDAO';
import { getOrCreateProgress } from '../db/dao/ProgressDAO';
import { buildFranchiseForTitle } from '../services/FranchiseService';
import { v4 as uuidv4 } from 'uuid';

async function addTitleToLibrary(result: AniListSearchResult): Promise<string> {
  const now = Date.now();
  if (result.anilist_id) {
    const existing = await getTitleByAnilistId(result.anilist_id);
    if (existing) return existing.title_id;
  }
  const titleId = uuidv4();
  await upsertTitle({
    title_id: titleId,
    anilist_id: result.anilist_id,
    mal_id: result.mal_id,
    romaji_title: result.romaji_title,
    english_title: result.english_title,
    media_format: result.media_format as any,
    total_episodes: result.total_episodes,
    cover_image_url: result.cover_image_url,
    updated_at: now,
  });
  const seasonId = uuidv4();
  await upsertSeason({ season_id: seasonId, title_id: titleId, season_number: 1 });
  if (result.total_episodes && result.total_episodes > 0) {
    for (let n = 1; n <= result.total_episodes; n++) {
      await upsertEpisode({
        episode_id: uuidv4(), title_id: titleId, season_id: seasonId,
        absolute_number: n, season_episode: n, canonical_kind: 'MAIN',
      });
    }
  }
  if (result.tags.length > 0) await upsertTitleTags(titleId, result.tags);
  await getOrCreateProgress(titleId);
  return titleId;
}

interface SlideToggleProps {
  isOn: boolean;
  onPress: () => void;
}

function SlideToggle({ isOn, onPress }: SlideToggleProps) {
  return (
    <TouchableOpacity
      style={[s.toggleBtn, { backgroundColor: isOn ? Colors.mint : Colors.gold }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[s.toggleBar, isOn ? s.toggleBarOn : s.toggleBarOff]} />
      <Text style={s.toggleLabel}>{isOn ? "OPEN" : "ADD"}{"\n"}{isOn ? ">" : "+"}</Text>
    </TouchableOpacity>
  );
}

interface ResultCardProps {
  result: AniListSearchResult;
  alreadyAdded: boolean;
  onAdd: () => void;
  onOpen: () => void;
}

function ResultCard({ result, alreadyAdded, onAdd, onOpen }: ResultCardProps) {
  const epLabel = result.total_episodes ? result.total_episodes + " EP" : "TBA";
  return (
    <View style={s.resultCard}>
      <View style={s.resultCover}>
        {result.cover_image_url ? (
          <Image source={{ uri: result.cover_image_url }} style={s.resultImg} />
        ) : (
          <View style={[s.resultImg, { backgroundColor: Colors.panelDeep, alignItems: "center", justifyContent: "center" }]}>
            <Text style={{ fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.borderMid }}>?</Text>
          </View>
        )}
      </View>
      <View style={s.resultInfo}>
        <Text style={s.resultTitle} numberOfLines={2}>
          {result.english_title ?? result.romaji_title}
        </Text>
        {result.english_title && result.romaji_title !== result.english_title && (
          <Text style={s.resultSubTitle} numberOfLines={1}>{result.romaji_title}</Text>
        )}
        <View style={s.resultMeta}>
          {result.media_format && <Text style={s.resultMetaText}>{result.media_format}</Text>}
          <Text style={s.resultMetaText}> · {epLabel}</Text>
          {result.status && <Text style={s.resultMetaText}> · {result.status.replace("_", " ")}</Text>}
        </View>
        {result.next_episode && result.next_airing_at && (
          <Text style={s.airingText}>
            EP {result.next_episode} → {new Date(result.next_airing_at).toLocaleDateString()}
          </Text>
        )}
      </View>
      <SlideToggle isOn={alreadyAdded} onPress={alreadyAdded ? onOpen : onAdd} />
    </View>
  );
}

export default function SearchScreen() {
  const navigation = useNavigation<any>();
  const [searchText, setSearchText] = useState("");
  const [results, setResults] = useState<AniListSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const doSearch = useCallback(async (text: string) => {
    if (text.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    setError(null);
    try {
      const r = await searchTitles(text.trim());
      setResults(r);
    } catch (e: any) {
      setError("Could not reach AniList. Check your connection.");
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
      if (result.anilist_id) {
        try {
          await buildFranchiseForTitle(titleId, result.anilist_id);
        } catch (fe) {
          console.log("[SearchScreen] Franchise build failed:", fe);
        }
      }
      Alert.alert(
        "Added",
        (result.english_title ?? result.romaji_title) + " added to your library.",
        [
          { text: "Open Tracker", onPress: () => navigation.navigate("Tracker", { title_id: titleId }) },
          { text: "Keep Searching", style: "cancel" },
        ],
      );
    } catch (e: any) {
      Alert.alert("Error", "Could not add title: " + (e.message ?? "unknown error"));
    }
  };

  const handleOpen = async (result: AniListSearchResult) => {
    const t = await getTitleByAnilistId(result.anilist_id);
    if (t) navigation.navigate("Tracker", { title_id: t.title_id });
  };

  return (
    <View style={s.root}>
      <View style={s.searchBar}>
        <View style={s.searchInput}>
          <Text style={s.searchIcon}>🔍</Text>
          <TextInput
            style={s.input}
            placeholder="Search anime..."
            placeholderTextColor={Colors.dim}
            value={searchText}
            onChangeText={handleChangeText}
            autoFocus
            returnKeyType="search"
            onSubmitEditing={() => doSearch(searchText)}
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => { setSearchText(""); setResults([]); }}>
              <Text style={s.clearIcon}>x</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      <Text style={s.poweredBy}>Powered by AniList API</Text>
      {searching && (
        <View style={s.center}>
          <ActivityIndicator color={Colors.gold} />
          <Text style={s.searchingText}>SEARCHING...</Text>
        </View>
      )}
      {error && <Panel style={{ margin: Spacing.lg }}><Text style={s.errorText}>{error}</Text></Panel>}
      {!searching && !error && results.length === 0 && searchText.length > 1 && (
        <View style={s.center}><Text style={s.noResults}>No results for "{searchText}"</Text></View>
      )}
      {!searching && results.length === 0 && searchText.length < 2 && (
        <View style={s.center}><Text style={s.hint}>TYPE AT LEAST 2 CHARACTERS TO SEARCH</Text></View>
      )}
      <FlatList
        data={results}
        keyExtractor={r => String(r.anilist_id)}
        contentContainerStyle={s.list}
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

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.void },
  searchBar: { padding: Spacing.md, backgroundColor: Colors.panel, borderBottomWidth: 2, borderBottomColor: Colors.borderMid },
  searchInput: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: Colors.panelDeep,
    borderWidth: 2, borderTopColor: Colors.borderMid, borderLeftColor: Colors.borderMid,
    borderBottomColor: Colors.borderLo, borderRightColor: Colors.borderLo,
    paddingHorizontal: Spacing.sm,
  },
  searchIcon: { fontSize: 18, marginRight: Spacing.xs },
  input: { flex: 1, fontFamily: Fonts.body, fontSize: FontSizes.bodyLg, color: Colors.cream, paddingVertical: Spacing.sm },
  clearIcon: { fontFamily: Fonts.body, fontSize: FontSizes.bodyLg, color: Colors.dim, padding: Spacing.xs },
  poweredBy: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.borderMid, textAlign: "center", paddingVertical: 4, backgroundColor: Colors.panelDeep },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: Spacing.xxl },
  searchingText: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.gold, marginTop: Spacing.md },
  noResults: { fontFamily: Fonts.body, fontSize: FontSizes.bodyLg, color: Colors.dim, textAlign: "center" },
  hint: { fontFamily: Fonts.display, fontSize: FontSizes.displayXs, color: Colors.borderMid, textAlign: "center", letterSpacing: 1 },
  errorText: { fontFamily: Fonts.body, fontSize: FontSizes.bodyMd, color: Colors.coral },
  list: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  resultCard: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.borderMid },
  resultCover: {},
  resultImg: { width: 48, height: 68, borderWidth: 1, borderColor: Colors.borderMid },
  resultInfo: { flex: 1 },
  resultTitle: { fontFamily: Fonts.body, fontSize: FontSizes.bodyLg, color: Colors.cream, lineHeight: 22, marginBottom: 2 },
  resultSubTitle: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.dim, marginBottom: 2 },
  resultMeta: { flexDirection: "row", flexWrap: "wrap" },
  resultMetaText: { fontFamily: Fonts.body, fontSize: FontSizes.bodySm, color: Colors.dim },
  airingText: { fontFamily: Fonts.display, fontSize: 8, color: Colors.mint, marginTop: 3 },
  toggleBtn: {
    width: 56, paddingVertical: 8, paddingHorizontal: 6,
    borderWidth: 2, borderColor: Colors.borderLo,
    alignItems: "center", justifyContent: "center", gap: 4,
  },
  toggleBar: { width: 32, height: 4, borderRadius: 2, backgroundColor: Colors.void },
  toggleBarOn: { alignSelf: "flex-end" },
  toggleBarOff: { alignSelf: "flex-start" },
  toggleLabel: { fontFamily: Fonts.display, fontSize: 9, color: Colors.void, textAlign: "center", lineHeight: 14 },
});
