import type { Recommendation } from '../../types';
import type { AboveFloorBucket } from './types';

const SLOT_ORDER: readonly AboveFloorBucket[] = ['safe_bet', 'stretch', 'wildcard'];

interface IndexedRecommendation {
  rec: Recommendation;
  index: number;
  sortRank: number;
}

/**
 * Selects up to three "Tonight" picks (safe_bet, stretch, wildcard) by lowest rank,
 * filling missing slots with the next best-ranked safe_bet and then any remaining
 * non-below_floor recommendation. Never picks below_floor items or mutates input.
 */
export function selectTonightPicks(
  recs: Recommendation[]
): { picks: Recommendation[]; rest: Recommendation[] } {
  if (!Array.isArray(recs) || recs.length === 0) {
    return { picks: [], rest: [] };
  }

  const ordered: IndexedRecommendation[] = recs
    .map((rec, index) => ({
      rec,
      index,
      sortRank:
        typeof rec.rank === 'number' && Number.isFinite(rec.rank)
          ? rec.rank
          : Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => (a.sortRank !== b.sortRank ? a.sortRank - b.sortRank : a.index - b.index));

  const pickedIndices = new Set<number>();
  const slots: Array<Recommendation | null> = [null, null, null];

  const takeFirstMatch = (predicate: (rec: Recommendation) => boolean): Recommendation | null => {
    for (const entry of ordered) {
      if (pickedIndices.has(entry.index)) continue;
      if (!predicate(entry.rec)) continue;
      pickedIndices.add(entry.index);
      return entry.rec;
    }
    return null;
  };

  SLOT_ORDER.forEach((bucket, slotIndex) => {
    slots[slotIndex] = takeFirstMatch((rec) => rec.bucket === bucket);
  });

  for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
    if (slots[slotIndex] !== null) continue;
    slots[slotIndex] =
      takeFirstMatch((rec) => rec.bucket === 'safe_bet') ??
      takeFirstMatch((rec) => rec.bucket !== 'below_floor');
  }

  const picks = slots.filter((item): item is Recommendation => item !== null);
  const rest = recs.filter((_, index) => !pickedIndices.has(index));

  return { picks, rest };
}
