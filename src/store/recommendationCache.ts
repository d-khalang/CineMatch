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
 * Reads recommendation cache from storage.
 * Parses once, validates leniently per recommendation, and never throws.
 * Returns null only when storage is empty/unparseable or not an object with a recommendations array.
 */
export function readRecommendationCache(): CachedRecommendationsData | null {
  try {
    const raw = safeGetItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.recommendations)) {
      return null;
    }

    const result: CachedRecommendationsData = {
      recommendations: obj.recommendations.filter(isValidRecommendation),
      generatedAt:
        typeof obj.generatedAt === 'number' && Number.isFinite(obj.generatedAt)
          ? obj.generatedAt
          : 0,
      usedProvider: typeof obj.usedProvider === 'string' ? obj.usedProvider : '',
    };

    if (typeof obj.tasteAnalysis === 'string' || obj.tasteAnalysis === null) {
      result.tasteAnalysis = obj.tasteAnalysis;
    }
    if (typeof obj.settingsFingerprint === 'string') {
      result.settingsFingerprint = obj.settingsFingerprint;
    }
    if (typeof obj.ratedCount === 'number' && Number.isFinite(obj.ratedCount)) {
      result.ratedCount = obj.ratedCount;
    }

    return result;
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
