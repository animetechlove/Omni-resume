// ─────────────────────────────────────────────────────────────────────────────
// src/services/FranchiseService.ts
// Automatically builds franchise connections from AniList relation data.
// Walks the relations graph outward (not just direct neighbors) so a whole
// multi-season franchise — e.g. Tokyo Ghoul S1 → √A → :re → :re 2nd Season —
// gets linked together in one pass, not just whichever title triggered it.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuidv4 } from 'uuid';
import { execute, query } from '../db/database';
import { upsertTitle, upsertSeason, upsertEpisode } from '../db/dao/TitleDAO';
import { getOrCreateProgress } from '../db/dao/ProgressDAO';

// ─── ANILIST RELATIONS QUERY ──────────────────────────────────────────────────

const RELATIONS_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    title { romaji english }
    format episodes status
    coverImage { large }
    startDate { year month day }
    relations {
      edges {
        relationType(version: 2)
        node {
          id
          title { romaji english }
          format episodes status
          coverImage { large }
          startDate { year month day }
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

// Relation types that keep a title in the "required" watch-order spine.
// Everything else (side stories, spin-offs, alternates, summaries, etc.) is
// still shown on the map but dimmed as optional/skip-safe.
const REQUIRED_RELATIONS = new Set(['PREQUEL', 'SEQUEL', 'PARENT']);

function startDateKey(startDate?: { year?: number; month?: number; day?: number }): number | undefined {
  if (!startDate?.year) return undefined;
  return startDate.year * 10000 + (startDate.month ?? 1) * 100 + (startDate.day ?? 1);
}

const MAX_NODES = 40;

interface VisitedNode {
  titleId: string;
  isRequired: boolean;
  orderKey?: number;
}

// ─── MAIN FUNCTION ────────────────────────────────────────────────────────────

/**
 * Crawls AniList's relations graph outward from `titleId`/`anilistId`
 * (capped at 40 titles), resolving or creating local rows for every
 * connected anime, and links the whole discovered set into one franchise
 * with computed watch order and required/optional status.
 */
export async function buildFranchiseForTitle(titleId: string, anilistId: number): Promise<void> {
  try {
    console.log('[FranchiseService] Building franchise for anilist:', anilistId);

    const visited = new Map<number, VisitedNode>();
    visited.set(anilistId, { titleId, isRequired: true });
    const queue: number[] = [anilistId];

    while (queue.length > 0 && visited.size < MAX_NODES) {
      const currentAnilistId = queue.shift()!;
      const currentTitleId = visited.get(currentAnilistId)!.titleId;

      let media: any;
      try {
        media = await fetchRelations(currentAnilistId);
      } catch (e) {
        console.error('[FranchiseService] failed to fetch relations for', currentAnilistId, e);
        continue;
      }
      if (!media) continue;

      const currentNode = visited.get(currentAnilistId)!;
      if (currentNode.orderKey === undefined) {
        currentNode.orderKey = startDateKey(media.startDate);
      }

      const edges = media.relations?.edges ?? [];
      for (const edge of edges) {
        if (edge.node.type !== 'ANIME') continue;

        const relationType: string = edge.relationType;
        const isRequiredEdge = REQUIRED_RELATIONS.has(relationType);
        const existing = visited.get(edge.node.id);

        if (existing) {
          if (isRequiredEdge) existing.isRequired = true;
          continue;
        }

        // Resolve or create a local row for this related title
        let relatedTitleId: string;
        const existingTitle = await query<{ title_id: string }>(
          `SELECT title_id FROM title WHERE anilist_id = ? LIMIT 1`,
          [edge.node.id],
        );

        if (existingTitle.length > 0) {
          relatedTitleId = existingTitle[0].title_id;
        } else {
          relatedTitleId = uuidv4();
          await upsertTitle({
            title_id:        relatedTitleId,
            anilist_id:      edge.node.id,
            romaji_title:    edge.node.title.romaji,
            english_title:   edge.node.title.english ?? undefined,
            media_format:    edge.node.format,
            total_episodes:  edge.node.episodes ?? undefined,
            cover_image_url: edge.node.coverImage?.large ?? undefined,
            updated_at:      Date.now(),
          });

          const seasonId = uuidv4();
          await upsertSeason({ season_id: seasonId, title_id: relatedTitleId, season_number: 1 });

          if (edge.node.episodes && edge.node.episodes > 0) {
            for (let n = 1; n <= Math.min(edge.node.episodes, 100); n++) {
              await upsertEpisode({
                episode_id:      uuidv4(),
                title_id:        relatedTitleId,
                season_id:       seasonId,
                absolute_number: n,
                season_episode:  n,
                canonical_kind:  edge.node.format === 'MOVIE' ? 'MOVIE' :
                                 edge.node.format === 'OVA' ? 'OVA' :
                                 edge.node.format === 'SPECIAL' ? 'SPECIAL' : 'MAIN',
              });
            }
          }

          await getOrCreateProgress(relatedTitleId);
        }

        visited.set(edge.node.id, {
          titleId: relatedTitleId,
          isRequired: isRequiredEdge,
          orderKey: startDateKey(edge.node.startDate),
        });

        await execute(
          `INSERT OR IGNORE INTO title_relation (title_relation_id, from_title_id, to_title_id, relation_type)
           VALUES (?, ?, ?, ?)`,
          [uuidv4(), currentTitleId, relatedTitleId, relationType],
        );

        queue.push(edge.node.id);
      }
    }

    if (visited.size <= 1) {
      console.log('[FranchiseService] No anime relations found');
      return;
    }

    // Reuse an existing franchise if any discovered title already belongs to one
    let franchiseId: string | null = null;
    for (const node of visited.values()) {
      const existing = await query<{ franchise_id: string }>(
        `SELECT franchise_id FROM franchise_title WHERE title_id = ? LIMIT 1`,
        [node.titleId],
      );
      if (existing.length > 0) { franchiseId = existing[0].franchise_id; break; }
    }

    const rootTitleRow = await query<{ romaji_title: string; english_title?: string }>(
      `SELECT romaji_title, english_title FROM title WHERE title_id = ? LIMIT 1`,
      [titleId],
    );
    const franchiseName = rootTitleRow[0]?.english_title ?? rootTitleRow[0]?.romaji_title ?? 'Franchise';

    if (!franchiseId) {
      franchiseId = uuidv4();
      await execute(`INSERT OR IGNORE INTO franchise (franchise_id, name) VALUES (?, ?)`, [franchiseId, franchiseName]);
      console.log('[FranchiseService] Created franchise:', franchiseName);
    }

    for (const node of visited.values()) {
      await execute(
        `INSERT INTO franchise_title (franchise_id, title_id, watch_order_position, is_required)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(franchise_id, title_id) DO UPDATE SET
           watch_order_position = excluded.watch_order_position,
           is_required = CASE WHEN excluded.is_required = 1 THEN 1 ELSE franchise_title.is_required END`,
        [franchiseId, node.titleId, node.orderKey ?? null, node.isRequired ? 1 : 0],
      );
    }

    console.log('[FranchiseService] Franchise built successfully with', visited.size, 'total titles');
  } catch (e) {
    console.error('[FranchiseService] Error building franchise:', e);
  }
}
