// ─────────────────────────────────────────────────────────────────────────────
// src/services/FranchiseSyncService.ts
// Builds franchise/franchise_title groupings by walking AniList's relations
// graph outward from a title (prequel/sequel/side-story/etc), on demand.
// ─────────────────────────────────────────────────────────────────────────────

import { v4 as uuidv4 } from 'uuid';
import type { Franchise, MediaFormat, RelationType } from '../types';
import {
  getTitleById, getTitleByAnilistId, upsertTitle, upsertTitleRelation,
  getFranchiseIdForTitle, upsertFranchise, linkTitleToFranchise,
} from '../db/dao/TitleDAO';
import { fetchTitleRelations, AniListRelationEdge } from './AniListClient';

// Relation types that keep a title in the "required" watch-order spine.
// Everything else (side stories, spin-offs, alternates, summaries, etc.) is
// still shown on the map but dimmed as optional/skip-safe.
const REQUIRED_RELATIONS = new Set<string>(['PREQUEL', 'SEQUEL', 'PARENT']);

const KNOWN_RELATION_TYPES = new Set<RelationType>([
  'PREQUEL', 'SEQUEL', 'SIDE_STORY', 'SPIN_OFF', 'ALTERNATIVE',
  'SUMMARY', 'ADAPTATION', 'PARENT', 'COMPILATION', 'CONTAINS', 'OTHER',
]);

function toRelationType(raw: string): RelationType {
  return KNOWN_RELATION_TYPES.has(raw as RelationType) ? (raw as RelationType) : 'OTHER';
}

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

/**
 * Crawls AniList's relations graph outward from `titleId`, resolving/creating
 * local title rows for every connected anime, and materializes the result as
 * a franchise + franchise_title grouping. Returns null if the title has no
 * anilist_id, has no relations, or the sync otherwise finds nothing to link.
 */
export async function syncFranchiseForTitle(titleId: string): Promise<Franchise | null> {
  const rootTitle = await getTitleById(titleId);
  if (!rootTitle?.anilist_id) return null;

  const visited = new Map<number, VisitedNode>();
  visited.set(rootTitle.anilist_id, { titleId, isRequired: true });

  const queue: number[] = [rootTitle.anilist_id];

  while (queue.length > 0 && visited.size < MAX_NODES) {
    const anilistId = queue.shift()!;
    const fromTitleId = visited.get(anilistId)!.titleId;

    let relations: { startDate?: { year?: number; month?: number; day?: number }; edges: AniListRelationEdge[] };
    try {
      relations = await fetchTitleRelations(anilistId);
    } catch (e) {
      console.error('[FranchiseSyncService] failed to fetch relations for', anilistId, e);
      continue;
    }

    const currentNode = visited.get(anilistId)!;
    if (currentNode.orderKey === undefined) {
      currentNode.orderKey = startDateKey(relations.startDate);
    }

    for (const edge of relations.edges) {
      if (edge.node.type !== 'ANIME') continue;

      const relationType = toRelationType(edge.relationType);
      const isRequiredEdge = REQUIRED_RELATIONS.has(relationType);
      const existing = visited.get(edge.node.id);

      if (existing) {
        if (isRequiredEdge) existing.isRequired = true;
        continue;
      }

      const related = await getTitleByAnilistId(edge.node.id);
      let relatedTitleId: string;
      if (related) {
        relatedTitleId = related.title_id;
      } else {
        relatedTitleId = uuidv4();
        await upsertTitle({
          title_id: relatedTitleId,
          anilist_id: edge.node.id,
          mal_id: edge.node.idMal,
          romaji_title: edge.node.title.romaji,
          english_title: edge.node.title.english,
          media_format: edge.node.format as MediaFormat | undefined,
          total_episodes: edge.node.episodes,
          cover_image_url: edge.node.coverImage?.large,
          updated_at: Date.now(),
        });
      }

      visited.set(edge.node.id, {
        titleId: relatedTitleId,
        isRequired: isRequiredEdge,
        orderKey: startDateKey(edge.node.startDate),
      });

      await upsertTitleRelation(fromTitleId, relatedTitleId, relationType);
      queue.push(edge.node.id);
    }
  }

  if (visited.size <= 1) return null; // no connections found

  // Reuse an existing franchise if any discovered title already belongs to one.
  let franchiseId: string | null = null;
  for (const node of visited.values()) {
    franchiseId = await getFranchiseIdForTitle(node.titleId);
    if (franchiseId) break;
  }

  const franchiseName = rootTitle.english_title ?? rootTitle.romaji_title;
  if (!franchiseId) {
    franchiseId = uuidv4();
  }
  await upsertFranchise(franchiseId, franchiseName);

  for (const node of visited.values()) {
    await linkTitleToFranchise(franchiseId, node.titleId, node.orderKey, node.isRequired);
  }

  return { franchise_id: franchiseId, name: franchiseName };
}
