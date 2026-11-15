import { Recommendation } from '../types';
import {
  STORAGE_KEYS,
  safeGetItem,
  safeSetItem,
  CachedRecommendationsData,
} from '../services/storage';

export type { CachedRecommendationsData };

/**
 * Validates whether an unknown value conforms to the Recommendation shape
 * with at least a valid movie object with a numeric ID.
 */
function isValidRecommendation(r: unknown): r is Recommendation {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return false;
  const rec = r as Record<string, unknown>;
  if (!rec.movie || typeof rec.movie !== 'object' || Array.isArray(rec.movie)) return false;
  const movie = rec.movie as Record<string, unknown>;
  return typeof movie.id === 'number' && Number.isFinite(movie.id);
}

/**
 * Validates the shape of parsed cached recommendations data.
 */
function isValidCachedRecommendationsData(data: unknown): data is CachedRecommendationsData {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj.recommendations)) return false;
  if (typeof obj.generatedAt !== 'number' || !Number.isFinite(obj.generatedAt)) return false;
  if (typeof obj.usedProvider !== 'string') return false;

  if (
    obj.tasteAnalysis !== undefined &&
    obj.tasteAnalysis !== null &&
    typeof obj.tasteAnalysis !== 'string'
  ) {
    return false;
  }
  if (obj.settingsFingerprint !== undefined && typeof obj.settingsFingerprint !== 'string') {
    return false;
  }
  if (
    obj.ratedCount !== undefined &&
    (typeof obj.ratedCount !== 'number' || !Number.isFinite(obj.ratedCount))
  ) {
    return false;
  }

  for (const rec of obj.recommendations) {
    if (!isValidRecommendation(rec)) {
      return false;
    }
  }

  return true;
}

/**
 * Reads recommendation cache from storage.
 * Parses once, validates the shape, and never throws.
 */
export function readRecommendationCache(): CachedRecommendationsData | null {
  try {
    const raw = safeGetItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidCachedRecommendationsData(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Writes recommendation cache data to storage via safeSetItem.
 */
export function writeRecommendationCache(data: CachedRecommendationsData): boolean {
  try {
    return safeSetItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(data));
  } catch {
    return false;
  }
}

/**
 * Patches recommendation cache: reads the current cache, merges the patch,
 * and writes once. When there is no cache, writes nothing and returns false.
 */
export function patchRecommendationCache(patch: Partial<CachedRecommendationsData>): boolean {
  try {
    const current = readRecommendationCache();
    if (!current) {
      return false;
    }
    const merged: CachedRecommendationsData = {
      ...current,
      ...patch,
    };
    return writeRecommendationCache(merged);
  } catch {
    return false;
  }
}

/**
 * Helper to preserve settingsFingerprint and ratedCount from cached recommendations,
 * falling back to in-memory lastRun values if available.
 */
export const getFingerprintAndRatedCountFallbacks = (
  cached: Partial<CachedRecommendationsData> | Record<string, unknown>,
  fallbackFingerprint: string | null,
  fallbackRatedCount: number | null
): { settingsFingerprint?: string; ratedCount?: number } => ({
  ...(cached.settingsFingerprint !== undefined
    ? { settingsFingerprint: cached.settingsFingerprint as string }
    : fallbackFingerprint !== null
    ? { settingsFingerprint: fallbackFingerprint }
    : {}),
  ...(cached.ratedCount !== undefined
    ? { ratedCount: cached.ratedCount as number }
    : fallbackRatedCount !== null
    ? { ratedCount: fallbackRatedCount }
    : {}),
});
