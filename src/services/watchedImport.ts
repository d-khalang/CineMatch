import { HiddenFilm, UserRating } from '../types';
import { WatchedRow } from './csvService';
import { HIDDEN_FILMS_CAP } from './storage';

export interface WatchedImportPlan {
  toHide: HiddenFilm[];
  skippedRated: number;
  skippedDuplicate: number;
  unresolved: number;
  droppedForCap: number;
}

/**
 * Pure planner. `resolved` maps a row's index in `rows` to its TMDB id (null/absent = unresolved).
 */
export function planWatchedImport(
  rows: WatchedRow[],
  existingRatings: Record<number, UserRating>,
  existingHidden: HiddenFilm[],
  resolved: Map<number, number | null>
): WatchedImportPlan {
  if (!rows || rows.length === 0) {
    return {
      toHide: [],
      skippedRated: 0,
      skippedDuplicate: 0,
      unresolved: 0,
      droppedForCap: 0,
    };
  }

  const safeRatings = existingRatings || {};
  const safeHidden = existingHidden || [];
  const safeResolved = resolved || new Map();

  let skippedRated = 0;
  let skippedDuplicate = 0;
  let unresolved = 0;

  const existingHiddenIds = new Set(safeHidden.map((h) => h.movieId));
  const plannedIds = new Set<number>();
  const planned: HiddenFilm[] = [];

  for (let i = 0; i < rows.length; i++) {
    const tmdbId = safeResolved.get(i);
    if (tmdbId === undefined || tmdbId === null) {
      unresolved++;
      continue;
    }

    if (safeRatings[tmdbId] !== undefined) {
      skippedRated++;
      continue;
    }

    if (existingHiddenIds.has(tmdbId) || plannedIds.has(tmdbId)) {
      skippedDuplicate++;
      continue;
    }

    plannedIds.add(tmdbId);
    planned.push({
      movieId: tmdbId,
      reason: 'seen',
      hiddenAt: rows[i].watchedAt ?? 0,
      title: rows[i].title,
    });
  }

  const freeSlots = Math.max(0, HIDDEN_FILMS_CAP - safeHidden.length);

  if (planned.length <= freeSlots) {
    return {
      toHide: planned,
      skippedRated,
      skippedDuplicate,
      unresolved,
      droppedForCap: 0,
    };
  }

  const droppedForCap = planned.length - freeSlots;

  if (freeSlots === 0) {
    return {
      toHide: [],
      skippedRated,
      skippedDuplicate,
      unresolved,
      droppedForCap,
    };
  }

  const indexed = planned.map((item, originalIndex) => ({ item, originalIndex }));

  // Keep newest by hiddenAt (ties: earlier row kept)
  indexed.sort((a, b) => {
    if (b.item.hiddenAt !== a.item.hiddenAt) {
      return b.item.hiddenAt - a.item.hiddenAt;
    }
    return a.originalIndex - b.originalIndex;
  });

  const kept = indexed.slice(0, freeSlots);
  // Restore row order
  kept.sort((a, b) => a.originalIndex - b.originalIndex);

  return {
    toHide: kept.map((k) => k.item),
    skippedRated,
    skippedDuplicate,
    unresolved,
    droppedForCap,
  };
}
