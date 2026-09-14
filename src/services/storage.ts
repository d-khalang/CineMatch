import { UserRating, Movie, AISettings, Recommendation } from '../types';
import { sanitizeOpenRouterModel } from './ai/openRouterProvider';

export const STORAGE_VERSION = 2;

export const STORAGE_KEYS = {
  RATINGS: 'cinematch_user_ratings_v2',
  WATCHLIST: 'cinematch_watchlist_v2',
  WATCHLIST_MOVIES: 'cinematch_watchlist_movies_v2',
  SETTINGS: 'cinematch_ai_settings_v2',
  CACHED_RECOMMENDATIONS: 'cinematch_cached_recs_v2',
  STORAGE_META: 'cinematch_storage_meta_v2',
  // Legacy v1 keys
  LEGACY_RATINGS: 'cinematch_user_ratings_v1',
  LEGACY_SETTINGS: 'cinematch_ai_settings_v1',
  LEGACY_WATCHLIST: 'cinematch_watchlist_v1',
  LEGACY_WATCHLIST_MOVIES: 'cinematch_watchlist_movies_v1',
} as const;

export interface CachedRecommendationsData {
  recommendations: Recommendation[];
  generatedAt: number;
  usedProvider: string;
  tasteAnalysis?: string | null;
}

export interface StorageStatus {
  isAvailable: boolean;
  quotaExceeded: boolean;
  lastError: string | null;
  migratedFromV1: boolean;
}

// In-memory fallback if storage is blocked or quota exceeded
const inMemoryStore: Record<string, string> = {};
// A failed deletion remains authoritative for this session until persisted or superseded.
const pendingDeletes = new Set<string>();
const failedMutations = new Map<string, { message: string; quota: boolean }>();
let quotaExceededState = false;
let lastStorageError: string | null = null;

const refreshMutationStatus = (): void => {
  const failures = [...failedMutations.values()];
  quotaExceededState = failures.some((failure) => failure.quota);
  lastStorageError = failures.at(-1)?.message ?? null;
};

const recordMutationFailure = (key: string, err: unknown): void => {
  const name = err && typeof err === 'object' && 'name' in err ? String(err.name) : '';
  const message = err instanceof Error ? err.message : String(err);
  const quota = name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || message.toLowerCase().includes('quota');
  failedMutations.set(key, {
    message: quota ? 'Browser storage quota exceeded. Changes kept in memory.' : message,
    quota,
  });
  refreshMutationStatus();
};

type StorageListener = (status: StorageStatus) => void;
const storageListeners = new Set<StorageListener>();

export const subscribeStorageStatus = (listener: StorageListener): (() => void) => {
  storageListeners.add(listener);
  return () => {
    storageListeners.delete(listener);
  };
};

const notifyStorageListeners = () => {
  const status = getStorageStatus();
  storageListeners.forEach((fn) => {
    try {
      fn(status);
    } catch {
      // ignore
    }
  });
};

export const isStorageAvailable = (): boolean => {
  try {
    const testKey = '__cm_storage_test__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch (err: unknown) {
    if (failedMutations.size === 0) {
      lastStorageError = err instanceof Error ? err.message : String(err);
    }
    return false;
  }
};

export const hasUnsavedStorageChanges = (): boolean => {
  if (pendingDeletes.size > 0 || failedMutations.size > 0) return true;
  return Object.keys(inMemoryStore).some((key) => {
    try {
      return localStorage.getItem(key) !== inMemoryStore[key];
    } catch {
      return true;
    }
  });
};

export const safeGetItem = (key: string): string | null => {
  if (pendingDeletes.has(key)) return null;
  // Authoritative check: pending or recent in-memory writes take precedence
  if (Object.prototype.hasOwnProperty.call(inMemoryStore, key)) {
    return inMemoryStore[key];
  }
  try {
    return localStorage.getItem(key);
  } catch (err: unknown) {
    lastStorageError = err instanceof Error ? err.message : String(err);
    return null;
  }
};

export const safeSetItem = (key: string, value: string): boolean => {
  pendingDeletes.delete(key); // The latest operation for a key wins.
  inMemoryStore[key] = value;
  try {
    localStorage.setItem(key, value);
    failedMutations.delete(key);
    refreshMutationStatus();
    notifyStorageListeners();
    return true;
  } catch (err: unknown) {
    recordMutationFailure(key, err);
    notifyStorageListeners();
    return false;
  }
};

export const safeRemoveItem = (key: string): boolean => {
  delete inMemoryStore[key];
  pendingDeletes.add(key);
  try {
    localStorage.removeItem(key);
    pendingDeletes.delete(key);
    failedMutations.delete(key);
    refreshMutationStatus();
    notifyStorageListeners();
    return true;
  } catch (err: unknown) {
    recordMutationFailure(key, err);
    notifyStorageListeners();
    return false;
  }
};

/** Retry pending operations only; never replay a deletion superseded by a new value. */
export const retryPendingStorageChanges = (): boolean => {
  for (const key of [...pendingDeletes]) safeRemoveItem(key);
  for (const key of [...failedMutations.keys()]) {
    if (!pendingDeletes.has(key) && Object.prototype.hasOwnProperty.call(inMemoryStore, key)) {
      safeSetItem(key, inMemoryStore[key]);
    }
  }
  notifyStorageListeners();
  return !hasUnsavedStorageChanges();
};

export const getStorageStatus = (): StorageStatus => {
  return {
    isAvailable: isStorageAvailable(),
    quotaExceeded: quotaExceededState,
    lastError: lastStorageError,
    migratedFromV1: safeGetItem(STORAGE_KEYS.STORAGE_META) === 'migrated_from_v1',
  };
};

/**
 * Migration from v1 to v2:
 * 1. Reads v1 settings and STRIPS ANY STORED SECRETS (geminiApiKey, openRouterApiKey, tmdbApiKey) immediately.
 * 2. Validates v1 data before attempting migration.
 * 3. Verifies durable disk persistence before deleting any legacy user data keys.
 * 4. Only marks migration complete if all non-empty datasets were durably saved.
 */
export const runStorageMigration = (): { migrated: boolean; secretsStripped: boolean } => {
  try {
    const alreadyMigrated = localStorage.getItem(STORAGE_KEYS.STORAGE_META);
    if (alreadyMigrated === 'migrated_from_v1') {
      return { migrated: false, secretsStripped: false };
    }

    const legacyRatings = localStorage.getItem(STORAGE_KEYS.LEGACY_RATINGS);
    const legacyWatchlist = localStorage.getItem(STORAGE_KEYS.LEGACY_WATCHLIST);
    const legacyWatchlistMovies = localStorage.getItem(STORAGE_KEYS.LEGACY_WATCHLIST_MOVIES);
    const legacySettingsStr = localStorage.getItem(STORAGE_KEYS.LEGACY_SETTINGS);

    let secretsStripped = false;
    let allSuccessful = true;

    // 1. Purge credentials separately from legacy settings immediately
    if (legacySettingsStr) {
      try {
        const parsed = JSON.parse(legacySettingsStr);
        if (parsed.geminiApiKey || parsed.openRouterApiKey || parsed.tmdbApiKey) {
          secretsStripped = true;
          delete parsed.geminiApiKey;
          delete parsed.openRouterApiKey;
          delete parsed.tmdbApiKey;
          try {
            // Overwrite legacy settings on disk without credentials
            localStorage.setItem(STORAGE_KEYS.LEGACY_SETTINGS, JSON.stringify(parsed));
          } catch {
            // ignore
          }
        }

        const sanitizedSettings: Partial<AISettings> = {
          activeProvider: parsed.activeProvider || 'gemini',
          geminiModel: parsed.geminiModel || 'gemini-3.8-flash',
          openRouterModel: sanitizeOpenRouterModel(parsed.openRouterModel),
          serendipityLevel: typeof parsed.serendipityLevel === 'number' ? parsed.serendipityLevel : 40,
          selectedVibes: Array.isArray(parsed.selectedVibes) ? parsed.selectedVibes : [],
          preferredEras: Array.isArray(parsed.preferredEras) ? parsed.preferredEras : [],
        };
        const settingsSerialized = JSON.stringify(sanitizedSettings);
        localStorage.setItem(STORAGE_KEYS.SETTINGS, settingsSerialized);
        if (localStorage.getItem(STORAGE_KEYS.SETTINGS) === settingsSerialized) {
          localStorage.removeItem(STORAGE_KEYS.LEGACY_SETTINGS);
        } else {
          allSuccessful = false;
        }
      } catch {
        // malformed legacy settings
      }
    }

    // 2. Migrate ratings with reconciliation and durable coverage verification
    if (legacyRatings) {
      try {
        const validated = validateRatings(JSON.parse(legacyRatings));
        if (Object.keys(validated).length > 0) {
          const currentV2Str = localStorage.getItem(STORAGE_KEYS.RATINGS);
          let existingV2: Record<number, UserRating> = {};
          if (currentV2Str) {
            try {
              existingV2 = validateRatings(JSON.parse(currentV2Str));
            } catch {
              existingV2 = {};
            }
          }

          // Conflict policy: existing v2 record takes precedence, missing legacy records are reconciled in
          const reconciled: Record<number, UserRating> = { ...validated, ...existingV2 };
          const serialized = JSON.stringify(reconciled);
          localStorage.setItem(STORAGE_KEYS.RATINGS, serialized);

          // Verify durable persistence and complete coverage of legacy records
          const readBack = localStorage.getItem(STORAGE_KEYS.RATINGS);
          if (readBack === serialized) {
            const savedV2 = validateRatings(JSON.parse(readBack));
            const hasFullCoverage = Object.keys(validated).every(
              (id) => Boolean(savedV2[Number(id)])
            );
            if (hasFullCoverage) {
              localStorage.removeItem(STORAGE_KEYS.LEGACY_RATINGS);
            } else {
              allSuccessful = false;
            }
          } else {
            allSuccessful = false;
          }
        } else {
          // Empty or invalid ratings
          localStorage.removeItem(STORAGE_KEYS.LEGACY_RATINGS);
        }
      } catch {
        allSuccessful = false;
      }
    }

    // 3. Migrate watchlist with reconciliation and durable coverage verification
    if (legacyWatchlist) {
      try {
        const validated = validateWatchlist(JSON.parse(legacyWatchlist));
        if (validated.length > 0) {
          const currentV2Str = localStorage.getItem(STORAGE_KEYS.WATCHLIST);
          let existingV2: number[] = [];
          if (currentV2Str) {
            try {
              existingV2 = validateWatchlist(JSON.parse(currentV2Str));
            } catch {
              existingV2 = [];
            }
          }

          // Reconcile: union of existing v2 and legacy items, preserving existing v2 order
          const existingSet = new Set(existingV2);
          const missingFromV2 = validated.filter((id) => !existingSet.has(id));
          const reconciled = [...existingV2, ...missingFromV2];
          const serialized = JSON.stringify(reconciled);
          localStorage.setItem(STORAGE_KEYS.WATCHLIST, serialized);

          // Verify durable persistence and complete coverage of legacy records
          const readBack = localStorage.getItem(STORAGE_KEYS.WATCHLIST);
          if (readBack === serialized) {
            const savedV2 = validateWatchlist(JSON.parse(readBack));
            const savedSet = new Set(savedV2);
            const hasFullCoverage = validated.every((id) => savedSet.has(id));
            if (hasFullCoverage) {
              localStorage.removeItem(STORAGE_KEYS.LEGACY_WATCHLIST);
            } else {
              allSuccessful = false;
            }
          } else {
            allSuccessful = false;
          }
        } else {
          localStorage.removeItem(STORAGE_KEYS.LEGACY_WATCHLIST);
        }
      } catch {
        allSuccessful = false;
      }
    }

    // 4. Migrate watchlist movies with reconciliation and durable coverage verification
    if (legacyWatchlistMovies) {
      try {
        const validated = validateWatchlistMovies(JSON.parse(legacyWatchlistMovies));
        if (Object.keys(validated).length > 0) {
          const currentV2Str = localStorage.getItem(STORAGE_KEYS.WATCHLIST_MOVIES);
          let existingV2: Record<number, Movie> = {};
          if (currentV2Str) {
            try {
              existingV2 = validateWatchlistMovies(JSON.parse(currentV2Str));
            } catch {
              existingV2 = {};
            }
          }

          // Reconcile: existing v2 takes precedence, missing legacy records are reconciled in
          const reconciled: Record<number, Movie> = { ...validated, ...existingV2 };
          const serialized = JSON.stringify(reconciled);
          localStorage.setItem(STORAGE_KEYS.WATCHLIST_MOVIES, serialized);

          // Verify durable persistence and complete coverage of legacy records
          const readBack = localStorage.getItem(STORAGE_KEYS.WATCHLIST_MOVIES);
          if (readBack === serialized) {
            const savedV2 = validateWatchlistMovies(JSON.parse(readBack));
            const hasFullCoverage = Object.keys(validated).every(
              (id) => Boolean(savedV2[Number(id)])
            );
            if (hasFullCoverage) {
              localStorage.removeItem(STORAGE_KEYS.LEGACY_WATCHLIST_MOVIES);
            } else {
              allSuccessful = false;
            }
          } else {
            allSuccessful = false;
          }
        } else {
          localStorage.removeItem(STORAGE_KEYS.LEGACY_WATCHLIST_MOVIES);
        }
      } catch {
        allSuccessful = false;
      }
    }

    if (allSuccessful) {
      try {
        localStorage.setItem(STORAGE_KEYS.STORAGE_META, 'migrated_from_v1');
      } catch {
        // If meta write fails, don't claim full completion
        return { migrated: false, secretsStripped };
      }
      return { migrated: true, secretsStripped };
    }

    return { migrated: false, secretsStripped };
  } catch {
    return { migrated: false, secretsStripped: false };
  }
};

/**
 * Validates ratings dictionary shape
 */
export const validateRatings = (data: unknown): Record<number, UserRating> => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {};
  }
  const result: Record<number, UserRating> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const id = Number(key);
    if (isNaN(id) || !value || typeof value !== 'object') continue;
    const r = value as Record<string, unknown>;
    if (
      typeof r.movieId === 'number' &&
      typeof r.title === 'string' &&
      typeof r.rating === 'number' &&
      r.rating >= 1 &&
      r.rating <= 10
    ) {
      result[id] = {
        movieId: r.movieId,
        title: r.title,
        rating: r.rating,
        posterPath: typeof r.posterPath === 'string' ? r.posterPath : null,
        year: typeof r.year === 'string' ? r.year : undefined,
        genres: Array.isArray(r.genres) ? r.genres.filter((g): g is string => typeof g === 'string') : [],
        director: typeof r.director === 'string' ? r.director : undefined,
        keywords: Array.isArray(r.keywords) ? r.keywords.filter((k): k is string => typeof k === 'string') : [],
        ratedAt: typeof r.ratedAt === 'number' ? r.ratedAt : Date.now(),
      };
    }
  }
  return result;
};

/**
 * Validates watchlist ID array shape
 */
export const validateWatchlist = (data: unknown): number[] => {
  if (!Array.isArray(data)) return [];
  const seen = new Set<number>();
  const valid: number[] = [];
  for (const item of data) {
    const id = Number(item);
    if (!isNaN(id) && id > 0 && !seen.has(id)) {
      seen.add(id);
      valid.push(id);
    }
  }
  return valid;
};

/**
 * Validates watchlist movies dictionary shape
 */
export const validateWatchlistMovies = (data: unknown): Record<number, Movie> => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const result: Record<number, Movie> = {};
  for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
    const id = Number(key);
    if (isNaN(id) || !val || typeof val !== 'object') continue;
    const m = val as Record<string, unknown>;
    if (typeof m.id === 'number' && typeof m.title === 'string') {
      result[id] = {
        id: m.id,
        title: m.title,
        overview: typeof m.overview === 'string' ? m.overview : '',
        poster_path: typeof m.poster_path === 'string' ? m.poster_path : null,
        backdrop_path: typeof m.backdrop_path === 'string' ? m.backdrop_path : null,
        release_date: typeof m.release_date === 'string' ? m.release_date : '',
        vote_average: typeof m.vote_average === 'number' ? m.vote_average : 0,
        vote_count: typeof m.vote_count === 'number' ? m.vote_count : 0,
        genres: Array.isArray(m.genres) ? (m.genres as any) : [],
        director: typeof m.director === 'string' ? m.director : undefined,
        keywords: Array.isArray(m.keywords) ? (m.keywords as any) : undefined,
        trailer_key: typeof m.trailer_key === 'string' ? m.trailer_key : undefined,
        imdb_id: typeof m.imdb_id === 'string' ? m.imdb_id : undefined,
      };
    }
  }
  return result;
};

export const clearInMemoryStoreForTesting = (): void => {
  for (const k of Object.keys(inMemoryStore)) {
    delete inMemoryStore[k];
  }
  pendingDeletes.clear();
  failedMutations.clear();
  quotaExceededState = false;
  lastStorageError = null;
};
