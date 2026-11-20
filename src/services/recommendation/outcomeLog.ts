import { STORAGE_KEYS, safeGetItem, safeRemoveItem, safeSetItem } from '../storage';
import type { AboveFloorBucket, Bucket, BucketMix } from './types';

export type OutcomeEntry = {
  movieId: number;
  bucket: AboveFloorBucket;
  shownAt: number;
  rating?: number;
  ratedAt?: number;
};

export type OutcomeLog = OutcomeEntry[];

export interface ExplorationSummary {
  hits: number;
  total: number;
}

export const OUTCOME_LOG_CAP = 500;
export const ADAPTIVE_MIN_OUTCOMES = 5;
export const ADAPTIVE_HIT_RATING = 8;
export const ADAPTIVE_LOW_RATING = 5;
export const ADAPTIVE_WILDCARD_STEP = 0.05;
export const ADAPTIVE_WILDCARD_MIN = 0.10;
export const ADAPTIVE_WILDCARD_MAX = 0.30;

function resolveNow(now?: number): number {
  return typeof now === 'number' && Number.isFinite(now) && now >= 0
    ? now
    : Date.now();
}

function isValidMovieId(id: unknown): id is number {
  return typeof id === 'number' && Number.isInteger(id) && id > 0;
}

function isAboveFloorBucket(bucket: unknown): bucket is AboveFloorBucket {
  return bucket === 'safe_bet' || bucket === 'stretch' || bucket === 'wildcard';
}

function isValidRating(rating: unknown): rating is number {
  return (
    typeof rating === 'number' &&
    Number.isFinite(rating) &&
    rating >= 1 &&
    rating <= 10
  );
}

function isValidTimestamp(ts: unknown): ts is number {
  return typeof ts === 'number' && Number.isFinite(ts) && ts >= 0;
}

function cloneEntry(entry: OutcomeEntry): OutcomeEntry {
  const cloned: OutcomeEntry = {
    movieId: entry.movieId,
    bucket: entry.bucket,
    shownAt: entry.shownAt,
  };
  if (entry.rating !== undefined) {
    cloned.rating = entry.rating;
  }
  if (entry.ratedAt !== undefined) {
    cloned.ratedAt = entry.ratedAt;
  }
  return cloned;
}

function normalizeEntry(raw: unknown): OutcomeEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  if (
    !isValidMovieId(candidate.movieId) ||
    !isAboveFloorBucket(candidate.bucket) ||
    !isValidTimestamp(candidate.shownAt)
  ) {
    return null;
  }

  // Construct a clean entry with no extra fields (such as titles or credentials).
  const entry: OutcomeEntry = {
    movieId: candidate.movieId,
    bucket: candidate.bucket,
    shownAt: candidate.shownAt,
  };

  if (candidate.rating !== undefined) {
    if (!isValidRating(candidate.rating)) {
      return null;
    }
    entry.rating = candidate.rating;
    if (isValidTimestamp(candidate.ratedAt)) {
      entry.ratedAt = candidate.ratedAt;
    }
  }

  return entry;
}

function capOutcomeLog(entries: OutcomeEntry[], cap = OUTCOME_LOG_CAP): OutcomeLog {
  if (entries.length <= cap) {
    return entries.map(cloneEntry);
  }
  const indexed = entries.map((entry, index) => ({ entry, index }));
  indexed.sort(
    (a, b) => a.entry.shownAt - b.entry.shownAt || a.index - b.index
  );
  const toDrop = new Set(
    indexed.slice(0, entries.length - cap).map((item) => item.index)
  );
  return entries.filter((_, index) => !toDrop.has(index)).map(cloneEntry);
}

function deduplicateAndNormalize(log: unknown): OutcomeEntry[] {
  if (!Array.isArray(log)) {
    return [];
  }

  const byMovieId = new Map<number, OutcomeEntry>();
  for (const raw of log) {
    const entry = normalizeEntry(raw);
    if (!entry) continue;
    const existing = byMovieId.get(entry.movieId);
    if (!existing) {
      byMovieId.set(entry.movieId, entry);
    } else if (
      existing.rating === undefined &&
      (entry.rating !== undefined || entry.shownAt >= existing.shownAt)
    ) {
      byMovieId.set(entry.movieId, entry);
    }
  }

  return Array.from(byMovieId.values());
}

function normalizeAndCapLog(log: unknown): OutcomeLog {
  return capOutcomeLog(deduplicateAndNormalize(log));
}

/**
 * Loads the recommendation outcome log from storage.
 * Lenient: drops malformed entries and returns [] on invalid JSON.
 */
export function loadOutcomeLog(): OutcomeLog {
  const raw = safeGetItem(STORAGE_KEYS.OUTCOME_LOG);
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  return normalizeAndCapLog(parsed);
}

/**
 * Persists the recommendation outcome log via safeSetItem.
 */
export function saveOutcomeLog(log: OutcomeLog): boolean {
  const normalized = normalizeAndCapLog(log);
  return safeSetItem(STORAGE_KEYS.OUTCOME_LOG, JSON.stringify(normalized));
}

/**
 * Clears the stored outcome log.
 */
export function resetOutcomeLog(): boolean {
  return safeRemoveItem(STORAGE_KEYS.OUTCOME_LOG);
}

/**
 * Purely records shown recommendations into the outcome log.
 * Skips `below_floor` and unbucketed items. Unrated existing entries get their
 * `bucket` and `shownAt` updated; already-rated entries are left alone.
 * Caps at 500 entries, evicting the oldest `shownAt` first.
 */
export function logShown(
  log: OutcomeLog,
  shown: ReadonlyArray<{ movieId: number; bucket?: Bucket }>,
  now = Date.now()
): OutcomeLog {
  const effectiveNow = resolveNow(now);
  const entries = normalizeAndCapLog(log);
  if (!Array.isArray(shown) || shown.length === 0) {
    return entries;
  }

  const indexByMovieId = new Map<number, number>();
  for (let i = 0; i < entries.length; i++) {
    indexByMovieId.set(entries[i].movieId, i);
  }

  for (const item of shown) {
    if (!item || typeof item !== 'object') continue;
    if (!isValidMovieId(item.movieId)) continue;
    if (!isAboveFloorBucket(item.bucket)) continue;

    const existingIdx = indexByMovieId.get(item.movieId);
    if (existingIdx === undefined) {
      indexByMovieId.set(item.movieId, entries.length);
      entries.push({
        movieId: item.movieId,
        bucket: item.bucket,
        shownAt: effectiveNow,
      });
    } else {
      const existing = entries[existingIdx];
      if (existing.rating === undefined) {
        entries[existingIdx] = {
          movieId: existing.movieId,
          bucket: item.bucket,
          shownAt: effectiveNow,
        };
      }
    }
  }

  return capOutcomeLog(entries);
}

/**
 * Purely records the user's first rating for a logged film.
 * Sets `rating` and `ratedAt` only if the film exists in the log and has no rating yet.
 */
export function recordOutcome(
  log: OutcomeLog,
  movieId: number,
  rating: number,
  now = Date.now()
): OutcomeLog {
  const entries = normalizeAndCapLog(log);
  if (!isValidMovieId(movieId) || !isValidRating(rating)) {
    return entries;
  }

  const effectiveNow = resolveNow(now);
  const idx = entries.findIndex((entry) => entry.movieId === movieId);
  if (idx === -1 || entries[idx].rating !== undefined) {
    return entries;
  }

  entries[idx] = {
    ...entries[idx],
    rating,
    ratedAt: effectiveNow,
  };
  return entries;
}

/**
 * Counts hits (rating >= 8) and total rated outcomes across `stretch` and `wildcard` entries.
 */
export function explorationSummary(log: OutcomeLog): ExplorationSummary {
  const entries = deduplicateAndNormalize(log);
  let hits = 0;
  let total = 0;
  for (const entry of entries) {
    if (entry.bucket !== 'stretch' && entry.bucket !== 'wildcard') continue;
    if (entry.rating === undefined) continue;
    total++;
    if (entry.rating >= ADAPTIVE_HIT_RATING) {
      hits++;
    }
  }

  return { hits, total };
}

/**
 * Purely adapts the bucket mix based on rated `stretch` and `wildcard` outcomes.
 * Needs at least 5 rated stretch/wildcard entries before adapting.
 * Adjusts wildcard share by +/-0.05 clamped to [0.10, 0.30]; `safe_bet` absorbs the difference.
 */
export function adaptiveMix(baseMix: BucketMix, log: OutcomeLog): BucketMix {
  const safeBase: BucketMix = {
    safe_bet: baseMix.safe_bet,
    stretch: baseMix.stretch,
    wildcard: baseMix.wildcard,
  };

  const entries = deduplicateAndNormalize(log);
  if (entries.length === 0) {
    return safeBase;
  }

  let count = 0;
  let ratingSum = 0;
  for (const entry of entries) {
    if (entry.bucket !== 'stretch' && entry.bucket !== 'wildcard') continue;
    if (entry.rating === undefined) continue;
    count++;
    ratingSum += entry.rating;
  }

  if (count < ADAPTIVE_MIN_OUTCOMES) {
    return safeBase;
  }

  const avgRating = ratingSum / count;
  let shift: number;
  if (avgRating >= ADAPTIVE_HIT_RATING) {
    shift = ADAPTIVE_WILDCARD_STEP;
  } else if (avgRating <= ADAPTIVE_LOW_RATING) {
    shift = -ADAPTIVE_WILDCARD_STEP;
  } else {
    return safeBase;
  }

  const rawSafe = Number.isFinite(baseMix.safe_bet) ? Math.max(0, baseMix.safe_bet) : 0;
  const rawStretch = Number.isFinite(baseMix.stretch) ? Math.max(0, baseMix.stretch) : 0;
  const rawWildcard = Number.isFinite(baseMix.wildcard) ? Math.max(0, baseMix.wildcard) : 0;
  const total = rawSafe + rawStretch + rawWildcard;

  if (total <= 0) {
    return { safe_bet: 1, stretch: 0, wildcard: 0 };
  }

  const safe = rawSafe / total;
  const stretch = rawStretch / total;
  const wildcard = rawWildcard / total;

  const clampedWildcard = Math.max(
    ADAPTIVE_WILDCARD_MIN,
    Math.min(ADAPTIVE_WILDCARD_MAX, wildcard + shift)
  );
  const nextWildcard = Math.min(clampedWildcard, safe + wildcard);
  const nextSafe = Math.max(0, 1 - stretch - nextWildcard);

  return {
    safe_bet: nextSafe,
    stretch,
    wildcard: nextWildcard,
  };
}
