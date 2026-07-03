// ─────────────────────────────────────────────────────────────────────────────
// src/services/FranchiseService.ts
// Automatically builds franchise connections from AniList relation data.
// When a title is added, this fetches all related titles and links them.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuidv4 } from 'uuid';
import { execute, query } from '../db/database';
import { upsertTitle, upsertSeason, upsertEpisode, upsertTitleTags } from '../db/dao/TitleDAO';
import { getOrCreateProgress } from '../db/dao/ProgressDAO';

// ─── ANILIST RELATIONS QUERY ──────────────────────────────────────────────────

const RELATIONS_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    title { romaji english }
    format episodes status
    coverImage { large }
    tags { name }
    nextAiringEpisode { episode airingAt }
    relations {
      edges {
        relationType
        node {
          id
          title { romaji english }
          format episodes status
          coverImage { large }
          type
        }
      }
    }
  }
}`;

async function fetchRelations(anilistId: number): Promise<any> {
  const axios = (await import('axios')).default;
  const response = await axios.post(
    'https://graphql.anilist.co',
    { query: RELATIONS_QUERY, variables: { id: anilistId } },
    { headers: { 'Content-Type': 'application/json' } },
  );
  return response.data.data.Media;
}

// ─── WATCH ORDER ─────────────────────────────────────────────────────────────
// Maps AniList relation types to watch order priority.
// Lower number = earlier in recommended watch order.

const RELATION_ORDER: Record<string, number> = {
  PREQUEL:     0,
  PARENT:      1,
  SEQUEL:      2,
  SIDE_STORY:  3,
  ALTERNATIVE: 4,
  SPIN_OFF:    5,
  SUMMARY:     6,
  OTHER:       7,
};

// ─── MAIN FUNCTION ────────────────────────────────────────────────────────────

export async function buildFranchiseForTitle(titleId: string, anilistId: number): Promise<void> {
  try {
    console.log('[FranchiseService] Building franchise for anilist:', anilistId);

    // Fetch the title and all its relations from AniList
    const media = await fetchRelations(anilistId);
    if (!media) return;

    // Filter to only anime relations
    const allRelations = media.relations?.edges ?? [];
    console.log('[FranchiseService] Total relations from AniList:', allRelations.length);
    const animeRelations = allRelations.filter(
      (edge: any) => edge.node.type === 'ANIME',
    );
    console.log('[FranchiseService] Anime relations:', animeRelations.length);
    animeRelations.forEach((e: any) => console.log(' -', e.relationType, e.node.title.romaji));

    if (animeRelations.length === 0) {
      console.log('[FranchiseService] No anime relations found');
      return;
    }

    // Check if a franchise already exists for any of these related titles
    let franchiseId: string | null = null;

    for (const edge of animeRelations) {
      const relatedAnilistId = edge.node.id;
      const existing = await query<{ franchise_id: string }>(
        `SELECT ft.franchise_id FROM franchise_title ft
         JOIN title t ON t.title_id = ft.title_id
         WHERE t.anilist_id = ? LIMIT 1`,
        [relatedAnilistId],
      );
      if (existing.length > 0) {
        franchiseId = existing[0].franchise_id;
        break;
      }
    }

    // Also check if the main title already has a franchise
    if (!franchiseId) {
      const existingMain = await query<{ franchise_id: string }>(
        `SELECT franchise_id FROM franchise_title WHERE title_id = ? LIMIT 1`,
        [titleId],
      );
      if (existingMain.length > 0) {
        franchiseId = existingMain[0].franchise_id;
      }
    }

    // Create a new franchise if none exists
    if (!franchiseId) {
      franchiseId = uuidv4();
      const franchiseName = media.title.english ?? media.title.romaji;
      await execute(
        `INSERT OR IGNORE INTO franchise (franchise_id, name) VALUES (?, ?)`,
        [franchiseId, franchiseName],
      );
      console.log('[FranchiseService] Created franchise:', franchiseName);
    }

    // Add the main title to the franchise
    await execute(
      `INSERT OR IGNORE INTO franchise_title (franchise_id, title_id, watch_order_position, is_required)
       VALUES (?, ?, 1.0, 1)`,
      [franchiseId, titleId],
    );

    // Add all related anime titles to the franchise
    let position = 2.0;
    for (const edge of animeRelations) {
      const node = edge.node;
      const relationType: string = edge.relationType;

      // Only include anime (not manga adaptations etc)
      if (node.type !== 'ANIME') continue;

      // Check if this related title is already in the local DB
      let relatedTitleId: string | null = null;
      const existingTitle = await query<{ title_id: string }>(
        `SELECT title_id FROM title WHERE anilist_id = ? LIMIT 1`,
        [node.id],
      );

      if (existingTitle.length > 0) {
        relatedTitleId = existingTitle[0].title_id;
      } else {
        // Create a stub title row for the related title
        relatedTitleId = uuidv4();
        await upsertTitle({
          title_id:        relatedTitleId,
          anilist_id:      node.id,
          romaji_title:    node.title.romaji,
          english_title:   node.title.english ?? undefined,
          media_format:    node.format,
          total_episodes:  node.episodes ?? undefined,
          cover_image_url: node.coverImage?.large ?? undefined,
          updated_at:      Date.now(),
        });

        // Create a default season
        const seasonId = uuidv4();
        await upsertSeason({
          season_id:     seasonId,
          title_id:      relatedTitleId,
          season_number: 1,
        });

        // Stub episodes if count is known
        if (node.episodes && node.episodes > 0) {
          for (let n = 1; n <= Math.min(node.episodes, 100); n++) {
            await upsertEpisode({
              episode_id:      uuidv4(),
              title_id:        relatedTitleId,
              season_id:       seasonId,
              absolute_number: n,
              season_episode:  n,
              canonical_kind:  node.format === 'MOVIE' ? 'MOVIE' :
                               node.format === 'OVA' ? 'OVA' :
                               node.format === 'SPECIAL' ? 'SPECIAL' : 'MAIN',
            });
          }
        }

        // Create progress row so it shows in franchise map
        await getOrCreateProgress(relatedTitleId);
      }

      // Add relation record
      await execute(
        `INSERT OR IGNORE INTO title_relation
           (title_relation_id, from_title_id, to_title_id, relation_type)
         VALUES (?, ?, ?, ?)`,
        [uuidv4(), titleId, relatedTitleId, relationType],
      );

      // Add to franchise with watch order
      const orderPosition = (RELATION_ORDER[relationType] ?? 5) + position;
      const isRequired = !['SUMMARY', 'ALTERNATIVE', 'SPIN_OFF'].includes(relationType) ? 1 : 0;

      await execute(
        `INSERT OR IGNORE INTO franchise_title
           (franchise_id, title_id, watch_order_position, is_required)
         VALUES (?, ?, ?, ?)`,
        [franchiseId, relatedTitleId, orderPosition, isRequired],
      );

      position += 0.1;
    }

    console.log('[FranchiseService] Franchise built successfully with', animeRelations.length, 'related titles');
  } catch (e) {
    console.error('[FranchiseService] Error building franchise:', e);
  }
}
