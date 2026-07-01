// ─────────────────────────────────────────────────────────────────────────────
// src/services/AniListClient.ts
// §13.1 — AniList official OAuth2 + GraphQL API client.
// Uses AniList's documented OAuth2 flow. Tokens stored encrypted (§13.1 note).
// Pull-only by default; never pushes silently. Never-regress merge in ImportService.
// ─────────────────────────────────────────────────────────────────────────────

import { Linking } from 'react-native';
import axios from 'axios';
import * as Keychain from 'react-native-keychain';
import type { ImportedListEntry, MediaFormat } from '../types';

const ANILIST_API   = 'https://graphql.anilist.co';
const ANILIST_AUTH  = 'https://anilist.co/api/v2/oauth/authorize';
const ANILIST_TOKEN = 'https://anilist.co/api/v2/oauth/token';

// Replace with your app's AniList client ID
const CLIENT_ID     = process.env.ANILIST_CLIENT_ID ?? 'YOUR_ANILIST_CLIENT_ID';
const REDIRECT_URI  = 'omniresume://oauth/anilist';

const KEYCHAIN_SERVICE = 'omni_resume_anilist';

// ─── OAUTH ───────────────────────────────────────────────────────────────────

export function launchOAuthFlow(): void {
  const url = `${ANILIST_AUTH}?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code`;
  Linking.openURL(url);
}

export async function handleOAuthCallback(code: string): Promise<string> {
  const response = await axios.post(ANILIST_TOKEN, {
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code,
  });
  const { access_token } = response.data as { access_token: string };
  // Store encrypted via Keychain — §13.1: never logged, never stored in plain AsyncStorage
  await Keychain.setInternetCredentials(KEYCHAIN_SERVICE, 'anilist', access_token);
  return access_token;
}

async function getStoredToken(): Promise<string | null> {
  const creds = await Keychain.getInternetCredentials(KEYCHAIN_SERVICE);
  return creds ? creds.password : null;
}

// ─── GRAPHQL HELPER ──────────────────────────────────────────────────────────

async function gql<T>(query: string, variables?: object): Promise<T> {
  const token = await getStoredToken();
  const response = await axios.post<{ data: T; errors?: object[] }>(
    ANILIST_API,
    { query, variables },
    {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  );
  if (response.data.errors) {
    throw new Error(`AniList GraphQL error: ${JSON.stringify(response.data.errors)}`);
  }
  return response.data.data;
}

// ─── FETCH TITLE METADATA (used at import time to create title/episode rows) ─

const TITLE_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    idMal
    title { romaji english }
    format
    episodes
    coverImage { large }
    relations {
      edges {
        relationType
        node { id title { romaji } }
      }
    }
    tags { name }
    nextAiringEpisode { episode airingAt }
  }
}`;

export async function fetchTitleMetadata(anilistId: number): Promise<AniListMedia | null> {
  const data = await gql<{ Media: AniListMedia | null }>(TITLE_QUERY, { id: anilistId });
  return data.Media;
}

// ─── FETCH USER LIST ─────────────────────────────────────────────────────────

const USER_LIST_QUERY = `
query ($userName: String) {
  MediaListCollection(userName: $userName, type: ANIME) {
    lists {
      entries {
        status
        progress
        score
        media {
          id
          idMal
          title { romaji english }
          format
          episodes
          coverImage { large }
          tags { name }
        }
      }
    }
  }
}`;

export async function fetchUserList(userName: string): Promise<ImportedListEntry[]> {
  const data = await gql<{ MediaListCollection: AniListListCollection }>(
    USER_LIST_QUERY,
    { userName },
  );

  const entries: ImportedListEntry[] = [];
  for (const list of data.MediaListCollection.lists) {
    for (const entry of list.entries) {
      entries.push({
        provider: 'ANILIST',
        anilist_id: entry.media.id,
        mal_id: entry.media.idMal ?? undefined,
        title_romaji: entry.media.title.romaji,
        title_english: entry.media.title.english ?? undefined,
        external_status: entry.status,
        progress_episodes: entry.progress ?? 0,
        score: entry.score ?? undefined,
        media_format: mapFormat(entry.media.format),
        total_episodes: entry.media.episodes ?? undefined,
        cover_image_url: entry.media.coverImage?.large ?? undefined,
      });
    }
  }
  return entries;
}

// ─── VIEWER (whoami) ─────────────────────────────────────────────────────────

const VIEWER_QUERY = `query { Viewer { id name } }`;

export async function fetchViewer(): Promise<{ id: number; name: string } | null> {
  const data = await gql<{ Viewer: { id: number; name: string } | null }>(VIEWER_QUERY);
  return data.Viewer;
}

// ─── TYPE HELPERS ────────────────────────────────────────────────────────────

function mapFormat(f?: string): MediaFormat | undefined {
  const MAP: Record<string, MediaFormat> = {
    TV: 'TV', MOVIE: 'MOVIE', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'SPECIAL',
  };
  return f ? MAP[f] : undefined;
}

// ─── RAW API TYPES ───────────────────────────────────────────────────────────

interface AniListMedia {
  id: number;
  idMal?: number;
  title: { romaji: string; english?: string };
  format?: string;
  episodes?: number;
  coverImage?: { large?: string };
  relations?: {
    edges: Array<{
      relationType: string;
      node: { id: number; title: { romaji: string } };
    }>;
  };
  tags?: Array<{ name: string }>;
  nextAiringEpisode?: { episode: number; airingAt: number };
}

interface AniListListCollection {
  lists: Array<{
    entries: Array<{
      status: any;
      progress?: number;
      score?: number;
      media: AniListMedia;
    }>;
  }>;
}

// ─── SEARCH (used by SearchScreen) ───────────────────────────────────────────

const SEARCH_QUERY = `
query ($search: String, $page: Int) {
  Page(page: $page, perPage: 20) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      id
      idMal
      title { romaji english }
      format
      episodes
      status
      coverImage { large }
      tags { name }
      nextAiringEpisode { episode airingAt }
    }
  }
}`;

export interface AniListSearchResult {
  anilist_id: number;
  mal_id?: number;
  romaji_title: string;
  english_title?: string;
  media_format?: string;
  total_episodes?: number;
  status?: string;
  cover_image_url?: string;
  tags: string[];
  next_episode?: number;
  next_airing_at?: number;
}

export async function searchTitles(
  searchQuery: string,
  page: number = 1,
): Promise<AniListSearchResult[]> {
  const data = await gql<{
    Page: { media: AniListMedia[] };
  }>(SEARCH_QUERY, { search: searchQuery, page });

  return (data.Page?.media ?? []).map(m => ({
    anilist_id: m.id,
    mal_id: m.idMal ?? undefined,
    romaji_title: m.title.romaji,
    english_title: m.title.english ?? undefined,
    media_format: m.format,
    total_episodes: m.episodes ?? undefined,
    status: (m as any).status,
    cover_image_url: m.coverImage?.large ?? undefined,
    tags: m.tags?.map(t => t.name) ?? [],
    next_episode: m.nextAiringEpisode?.episode,
    next_airing_at: m.nextAiringEpisode?.airingAt
      ? m.nextAiringEpisode.airingAt * 1000
      : undefined,
  }));
}
