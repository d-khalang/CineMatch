import { Recommendation } from '../types';
import { getEraDateRange } from '../services/tmdb';

export function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

/**
 * Coerces a score into a finite number clamped to 0–100.
 * Missing, undefined, NaN, or non-finite scores become 0.
 */
export function coerceScore(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) ? clamp(x, 0, 100) : 0;
}

/**
 * Checks whether a movie's release date falls into the user's preferred eras.
 * When preferredEras is empty, returns true (no era filtering).
 * When releaseDate is missing or cannot be parsed, returns true to avoid dropping picks.
 */
export function matchesPreferredEras(
  releaseDate: string | undefined,
  preferredEras: string[] | undefined
): boolean {
  if (!preferredEras || preferredEras.length === 0) return true;
  if (!releaseDate || typeof releaseDate !== 'string') return true;

  const match = releaseDate.match(/\b(\d{4})\b/);
  if (!match) return true;
  const year = parseInt(match[1], 10);
  if (!Number.isFinite(year)) return true;

  const decadeStart = Math.floor(year / 10) * 10;
  const decade4Digit = `${decadeStart}s`.toLowerCase();
  const decade2Digit = `${String(decadeStart).slice(-2)}s`.toLowerCase();

  return preferredEras.some((era) => {
    if (typeof era !== 'string') return false;
    const trimmed = era.trim().toLowerCase();
    if (trimmed === decade4Digit || trimmed === decade2Digit) {
      return true;
    }
    const range = getEraDateRange(era);
    if (range) {
      const startYear = parseInt(range.gte.slice(0, 4), 10);
      const endYear = parseInt(range.lte.slice(0, 4), 10);
      return year >= startYear && year <= endYear;
    }
    return false;
  });
}

/**
 * Sorts recommendations ensuring items with origin === 'local_backfill' sort after
 * all other recommendations (AI pool picks and AI discoveries). Within each group,
 * items sort by score descending. Ranks are renumbered 1..n in final order.
 */
export function sortAndRankRecommendations(recs: Recommendation[]): Recommendation[] {
  const nonBackfill: Recommendation[] = [];
  const backfill: Recommendation[] = [];

  for (const r of recs) {
    if (r.origin === 'local_backfill') {
      backfill.push(r);
    } else {
      nonBackfill.push(r);
    }
  }

  const scoreOf = (r: Recommendation) =>
    typeof r.score === 'number' && Number.isFinite(r.score) ? r.score : 0;

  nonBackfill.sort((a, b) => scoreOf(b) - scoreOf(a));
  backfill.sort((a, b) => scoreOf(b) - scoreOf(a));

  return [...nonBackfill, ...backfill].map((rec, idx) => ({
    ...rec,
    rank: idx + 1,
  }));
}
