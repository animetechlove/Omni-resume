import { Linking } from 'react-native';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ImportedListEntry, MediaFormat } from '../types';

const ANILIST_API   = 'https://graphql.anilist.co';
const ANILIST_AUTH  = 'https://anilist.co/api/v2/oauth/authorize';
const ANILIST_TOKEN = 'https://anilist.co/api/v2/oauth/token';
const CLIENT_ID     = process.env.ANILIST_CLIENT_ID ?? 'YOUR_ANILIST_CLIENT_ID';
const REDIRECT_URI  = 'omniresume://oauth/anilist';
const TOKEN_KEY     = '@omniresume/anilist_token';

export function launchOAuthFlow(): void {
  Linking.openURL(`${ANILIST_AUTH}?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code`);
}

export async function handleOAuthCallback(code: string): Promise<string> {
  const response = await axios.post(ANILIST_TOKEN, {
    grant_type: 'authorization_code', client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, code,
  });
  const { access_token } = response.data as { access_token: string };
  await AsyncStorage.setItem(TOKEN_KEY, access_token);
  return access_token;
}

async function getStoredToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

async function gql<T>(query: string, variables?: object): Promise<T> {
  const token = await getStoredToken();
  const response = await axios.post<{ data: T; errors?: object[] }>(
    ANILIST_API, { query, variables },
    { headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
  );
  if (response.data.errors) throw new Error(`AniList error: ${JSON.stringify(response.data.errors)}`);
  return response.data.data;
}

export async function fetchTitleMetadata(anilistId: number): Promise<any> {
  const data = await gql<{ Media: any }>(`query ($id: Int) { Media(id: $id, type: ANIME) { id idMal title { romaji english } format episodes coverImage { large } tags { name } nextAiringEpisode { episode airingAt } } }`, { id: anilistId });
  return data.Media;
}

export async function fetchUserList(userName: string): Promise<ImportedListEntry[]> {
  const data = await gql<{ MediaListCollection: any }>(`query ($userName: String) { MediaListCollection(userName: $userName, type: ANIME) { lists { entries { status progress score media { id idMal title { romaji english } format episodes coverImage { large } tags { name } } } } } }`, { userName });
  const entries: ImportedListEntry[] = [];
  for (const list of data.MediaListCollection.lists) {
    for (const entry of list.entries) {
      entries.push({
        provider: 'ANILIST', anilist_id: entry.media.id, mal_id: entry.media.idMal ?? undefined,
        title_romaji: entry.media.title.romaji, title_english: entry.media.title.english ?? undefined,
        external_status: entry.status, progress_episodes: entry.progress ?? 0, score: entry.score ?? undefined,
        media_format: entry.media.format as MediaFormat, total_episodes: entry.media.episodes ?? undefined,
        cover_image_url: entry.media.coverImage?.large ?? undefined,
      });
    }
  }
  return entries;
}

export async function fetchViewer(): Promise<{ id: number; name: string } | null> {
  const data = await gql<{ Viewer: { id: number; name: string } | null }>(`query { Viewer { id name } }`);
  return data.Viewer;
}

export interface AniListSearchResult {
  anilist_id: number; mal_id?: number; romaji_title: string; english_title?: string;
  media_format?: string; total_episodes?: number; status?: string; cover_image_url?: string;
  tags: string[]; next_episode?: number; next_airing_at?: number;
}

export async function searchTitles(searchQuery: string, page: number = 1): Promise<AniListSearchResult[]> {
  const data = await gql<{ Page: { media: any[] } }>(`query ($search: String, $page: Int) { Page(page: $page, perPage: 20) { media(search: $search, type: ANIME, sort: SEARCH_MATCH) { id idMal title { romaji english } format episodes status coverImage { large } tags { name } nextAiringEpisode { episode airingAt } } } }`, { search: searchQuery, page });
  return (data.Page?.media ?? []).map(m => ({
    anilist_id: m.id, mal_id: m.idMal ?? undefined, romaji_title: m.title.romaji,
    english_title: m.title.english ?? undefined, media_format: m.format,
    total_episodes: m.episodes ?? undefined, status: m.status,
    cover_image_url: m.coverImage?.large ?? undefined, tags: m.tags?.map((t: any) => t.name) ?? [],
    next_episode: m.nextAiringEpisode?.episode,
    next_airing_at: m.nextAiringEpisode?.airingAt ? m.nextAiringEpisode.airingAt * 1000 : undefined,
  }));
}