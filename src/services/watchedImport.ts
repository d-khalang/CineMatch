import { HiddenFilm, UserRating } from '../types';
import { WatchedRow } from './csvService';

// CIN-47 stub
export interface WatchedImportPlan {
  toHide: HiddenFilm[];
  skippedRated: number;
  skippedDuplicate: number;
  unresolved: number;
  droppedForCap: number;
}

// CIN-47 stub
/**
 * Pure planner. `resolved` maps a row's index in `rows` to its TMDB id (null/absent = unresolved).
 */
export function planWatchedImport(
  rows: WatchedRow[],
  existingRatings: Record<number, UserRating>,
  existingHidden: HiddenFilm[],
  resolved: Map<number, number | null>
): WatchedImportPlan {
  void rows;
  void existingRatings;
  void existingHidden;
  void resolved;
  throw new Error('CIN-47 not implemented: planWatchedImport');
}
