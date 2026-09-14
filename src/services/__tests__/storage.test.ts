import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  runStorageMigration,
  safeGetItem,
  safeSetItem,
  safeRemoveItem,
  retryPendingStorageChanges,
  getStorageStatus,
  hasUnsavedStorageChanges,
  subscribeStorageStatus,
  clearInMemoryStoreForTesting,
  STORAGE_KEYS,
  validateRatings,
  validateWatchlist,
  validateWatchlistMovies,
} from '../storage';

describe('Storage Service, Migration & Validation', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    vi.restoreAllMocks();
  });

  it('keeps failed deletion pending across unrelated writes until a successful retry', () => {
    localStorage.setItem('delete-me', 'old');
    const originalRemove = Storage.prototype.removeItem;
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
      if (key === 'delete-me') throw new Error('Deletion blocked');
      return originalRemove.call(this, key);
    });
    const statuses: ReturnType<typeof getStorageStatus>[] = [];
    const unsubscribe = subscribeStorageStatus((status) => statuses.push(status));
    try {
      expect(safeRemoveItem('delete-me')).toBe(false);
      expect(safeGetItem('delete-me')).toBeNull();
      expect(localStorage.getItem('delete-me')).toBe('old');
      expect(safeSetItem('unrelated', 'saved')).toBe(true);
      expect(hasUnsavedStorageChanges()).toBe(true);
      expect(getStorageStatus().lastError).toBe('Deletion blocked');
      expect(retryPendingStorageChanges()).toBe(false);
      expect(hasUnsavedStorageChanges()).toBe(true);
      remove.mockRestore();
      expect(retryPendingStorageChanges()).toBe(true);
      expect(localStorage.getItem('delete-me')).toBeNull();
      expect(hasUnsavedStorageChanges()).toBe(false);
      expect(statuses.at(-1)?.lastError).toBeNull();
    } finally {
      unsubscribe();
      remove.mockRestore();
    }
  });

  it('does not retry a deletion superseded by a newer value', () => {
    localStorage.setItem('changed', 'old');
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('Deletion blocked');
    });
    expect(safeRemoveItem('changed')).toBe(false);
    remove.mockRestore();
    expect(safeSetItem('changed', 'new')).toBe(true);
    expect(retryPendingStorageChanges()).toBe(true);
    expect(safeGetItem('changed')).toBe('new');
    expect(localStorage.getItem('changed')).toBe('new');
  });

  it('does not replay a failed write after it is superseded by deletion', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    expect(safeSetItem('changed', 'pending value')).toBe(false);
    set.mockRestore();
    expect(safeRemoveItem('changed')).toBe(true);
    expect(retryPendingStorageChanges()).toBe(true);
    expect(localStorage.getItem('changed')).toBeNull();
    expect(getStorageStatus().quotaExceeded).toBe(false);
  });

  it('retains a failed write status when another key is successfully saved', () => {
    const originalSet = Storage.prototype.setItem;
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'pending') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return originalSet.call(this, key, value);
    });
    expect(safeSetItem('pending', 'new')).toBe(false);
    expect(safeSetItem('other', 'saved')).toBe(true);
    expect(getStorageStatus().quotaExceeded).toBe(true);
    set.mockRestore();
    expect(retryPendingStorageChanges()).toBe(true);
    expect(localStorage.getItem('pending')).toBe('new');
    expect(getStorageStatus().quotaExceeded).toBe(false);
  });

  it('migrates v1 ratings to v2 and strips stored secrets from settings', () => {
    // Seed legacy v1 data with exposed API keys
    const legacyRatings = JSON.stringify({
      101: {
        movieId: 101,
        title: 'Legacy Inception',
        rating: 9,
        genres: ['Action', 'Sci-Fi'],
        ratedAt: 1600000000000,
      },
    });
    const legacySettings = JSON.stringify({
      activeProvider: 'gemini',
      geminiApiKey: 'EXPOSED_GEMINI_KEY',
      openRouterApiKey: 'EXPOSED_OPENROUTER_KEY',
      serendipityLevel: 50,
      selectedVibes: ['Mind-bending'],
      preferredEras: ['2010s'],
    });

    localStorage.setItem(STORAGE_KEYS.LEGACY_RATINGS, legacyRatings);
    localStorage.setItem(STORAGE_KEYS.LEGACY_SETTINGS, legacySettings);

    const { migrated, secretsStripped } = runStorageMigration();
    expect(migrated).toBe(true);
    expect(secretsStripped).toBe(true);

    // Verify v2 ratings are populated
    const v2Ratings = safeGetItem(STORAGE_KEYS.RATINGS);
    expect(v2Ratings).toBeDefined();
    expect(JSON.parse(v2Ratings!).title).toBeUndefined(); // map of id -> rating
    expect(JSON.parse(v2Ratings!)[101].title).toBe('Legacy Inception');

    // Verify secrets are NOT in v2 settings
    const v2Settings = JSON.parse(safeGetItem(STORAGE_KEYS.SETTINGS)!);
    expect(v2Settings.geminiApiKey).toBeUndefined();
    expect(v2Settings.openRouterApiKey).toBeUndefined();
    expect(v2Settings.serendipityLevel).toBe(50);

    // Verify legacy keys were removed
    expect(localStorage.getItem(STORAGE_KEYS.LEGACY_RATINGS)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.LEGACY_SETTINGS)).toBeNull();
  });

  it('validates ratings schema and discards invalid entries', () => {
    const raw = {
      1: { movieId: 1, title: 'Valid Film', rating: 8, genres: ['Drama'], ratedAt: 12345 },
      2: { movieId: 2, title: 'Invalid Rating Over 10', rating: 15 },
      3: { movieId: 3, title: 1234, rating: 5 }, // title is not string
      invalidKey: { movieId: 4, title: 'Not numeric key', rating: 7 },
    };

    const validated = validateRatings(raw);
    expect(validated[1]).toBeDefined();
    expect(validated[1].title).toBe('Valid Film');
    expect(validated[2]).toBeUndefined();
    expect(validated[3]).toBeUndefined();
    expect(validated[4]).toBeUndefined();
  });

  it('validates watchlist IDs and deduplicates items', () => {
    const raw = [101, '202', 101, -5, 'invalid', null, 303];
    const validated = validateWatchlist(raw);
    expect(validated).toEqual([101, 202, 303]);
  });

  it('validates watchlist movies and extracts required fields', () => {
    const raw = {
      10: { id: 10, title: 'Watchlist Film', overview: 'Movie overview', vote_average: 7.8 },
      bad: { id: 'not-num', title: 'Bad' },
    };
    const validated = validateWatchlistMovies(raw);
    expect(validated[10]).toBeDefined();
    expect(validated[10].title).toBe('Watchlist Film');
    expect(Object.keys(validated).length).toBe(1);
  });

  it('safeGetItem authoritatively returns in-memory state when disk write fails', () => {
    // 1. Initial write to disk
    localStorage.setItem('test_key', 'initial_disk_value');

    // 2. Next write fails due to browser quota
    const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw quotaError;
    });

    const success = safeSetItem('test_key', 'pending_memory_value');
    expect(success).toBe(false);

    // safeGetItem MUST return the pending in-memory value, NOT the stale disk value
    expect(safeGetItem('test_key')).toBe('pending_memory_value');
    expect(hasUnsavedStorageChanges()).toBe(true);

    const status = getStorageStatus();
    expect(status.quotaExceeded).toBe(true);
    expect(status.lastError).toContain('Browser storage quota exceeded');

    setItemSpy.mockRestore();
  });

  it('migration failure on disk write preserves legacy ratings and does not set STORAGE_META', () => {
    const legacyRatings = JSON.stringify({
      101: { movieId: 101, title: 'Preserved Legacy Film', rating: 10, ratedAt: 12345 },
    });
    const legacySettings = JSON.stringify({
      geminiApiKey: 'LEAKED_KEY_TO_PURGE',
      activeProvider: 'gemini',
    });

    localStorage.setItem(STORAGE_KEYS.LEGACY_RATINGS, legacyRatings);
    localStorage.setItem(STORAGE_KEYS.LEGACY_SETTINGS, legacySettings);

    // Mock localStorage.setItem to throw when writing the v2 ratings key
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === STORAGE_KEYS.RATINGS) {
        throw new DOMException('Disk write failed', 'QuotaExceededError');
      }
      return originalSetItem.call(this, key, value);
    });

    const result = runStorageMigration();

    // 1. Migration must be marked failed
    expect(result.migrated).toBe(false);

    // 2. Legacy ratings must NOT be deleted
    expect(localStorage.getItem(STORAGE_KEYS.LEGACY_RATINGS)).toBe(legacyRatings);

    // 3. Storage metadata marker must NOT be set
    expect(localStorage.getItem(STORAGE_KEYS.STORAGE_META)).toBeNull();

    // 4. Exposed secrets in legacy settings must STILL be purged
    const cleanedSettings = JSON.parse(localStorage.getItem(STORAGE_KEYS.LEGACY_SETTINGS) || '{}');
    expect(cleanedSettings.geminiApiKey).toBeUndefined();
    expect(result.secretsStripped).toBe(true);
  });

  it('notifies storage status listeners on quota limits', () => {
    let notifiedStatus: any = null;
    const unsubscribe = subscribeStorageStatus((status) => {
      notifiedStatus = status;
    });

    const quotaError = new DOMException('Quota exceeded', 'QuotaExceededError');
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw quotaError;
    });

    safeSetItem('quota_key', 'val');
    expect(notifiedStatus).not.toBeNull();
    expect(notifiedStatus.quotaExceeded).toBe(true);

    unsubscribe();
    setItemSpy.mockRestore();
  });

  it('recovers and reconciles legacy ratings into v2 when v2 contains an empty object', () => {
    // Valid legacy ratings exist, and v2 key contains empty {} from prior failed attempt
    const legacyRatings = JSON.stringify({
      42: {
        movieId: 42,
        title: 'The Shawshank Redemption',
        rating: 10,
        genres: ['Drama'],
        ratedAt: 1600000000000,
      },
    });
    localStorage.setItem(STORAGE_KEYS.LEGACY_RATINGS, legacyRatings);
    localStorage.setItem(STORAGE_KEYS.RATINGS, '{}');

    const result = runStorageMigration();

    // Migration must successfully reconcile and recover the ratings into v2
    expect(result.migrated).toBe(true);
    expect(localStorage.getItem(STORAGE_KEYS.STORAGE_META)).toBe('migrated_from_v1');

    const savedV2 = JSON.parse(localStorage.getItem(STORAGE_KEYS.RATINGS)!);
    expect(savedV2[42]).toBeDefined();
    expect(savedV2[42].title).toBe('The Shawshank Redemption');

    // Legacy data safely deleted after verified durable coverage
    expect(localStorage.getItem(STORAGE_KEYS.LEGACY_RATINGS)).toBeNull();
  });

  it('reconciles partial v2 ratings with legacy records and deletes legacy only after verified coverage', () => {
    // Legacy contains movies A (101) and B (202)
    const legacyRatings = JSON.stringify({
      101: { movieId: 101, title: 'Movie A', rating: 7, ratedAt: 1000 },
      202: { movieId: 202, title: 'Movie B', rating: 8, ratedAt: 1000 },
    });
    // v2 contains only A (101) with an updated rating
    const existingV2 = JSON.stringify({
      101: { movieId: 101, title: 'Movie A', rating: 10, ratedAt: 2000 },
    });

    localStorage.setItem(STORAGE_KEYS.LEGACY_RATINGS, legacyRatings);
    localStorage.setItem(STORAGE_KEYS.RATINGS, existingV2);

    const result = runStorageMigration();
    expect(result.migrated).toBe(true);

    // v2 must contain BOTH movies; A keeps v2 rating (10), B is reconciled from legacy (8)
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.RATINGS)!);
    expect(saved[101].rating).toBe(10);
    expect(saved[202].rating).toBe(8);
    expect(saved[202].title).toBe('Movie B');

    // Legacy ratings deleted because coverage of all legacy records is complete
    expect(localStorage.getItem(STORAGE_KEYS.LEGACY_RATINGS)).toBeNull();
  });

  it('reconciles partial v2 watchlist and watchlist movies with legacy records', () => {
    localStorage.setItem(STORAGE_KEYS.LEGACY_WATCHLIST, JSON.stringify([101, 202]));
    localStorage.setItem(STORAGE_KEYS.WATCHLIST, JSON.stringify([101]));

    localStorage.setItem(
      STORAGE_KEYS.LEGACY_WATCHLIST_MOVIES,
      JSON.stringify({
        101: { id: 101, title: 'Movie 101' },
        202: { id: 202, title: 'Movie 202' },
      })
    );
    localStorage.setItem(
      STORAGE_KEYS.WATCHLIST_MOVIES,
      JSON.stringify({
        101: { id: 101, title: 'Movie 101 V2' },
      })
    );

    const result = runStorageMigration();
    expect(result.migrated).toBe(true);

    const savedWatchlist = JSON.parse(localStorage.getItem(STORAGE_KEYS.WATCHLIST)!);
    expect(savedWatchlist).toContain(101);
    expect(savedWatchlist).toContain(202);

    const savedMovies = JSON.parse(localStorage.getItem(STORAGE_KEYS.WATCHLIST_MOVIES)!);
    expect(savedMovies[101].title).toBe('Movie 101 V2');
    expect(savedMovies[202].title).toBe('Movie 202');

    expect(localStorage.getItem(STORAGE_KEYS.LEGACY_WATCHLIST)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.LEGACY_WATCHLIST_MOVIES)).toBeNull();
  });
});
