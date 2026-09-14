import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MovieStoreProvider, useMovieStore } from '../useMovieStore';
import { Movie, UserRating } from '../../types';
import { safeGetItem, safeRemoveItem, safeSetItem, retryPendingStorageChanges, STORAGE_KEYS, runStorageMigration, clearInMemoryStoreForTesting } from '../../services/storage';
import { credentialStore } from '../../services/credentialStore';
import { getMovieDetails } from '../../services/tmdb';

vi.mock('../../services/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/tmdb')>();
  return {
    ...actual,
    getMovieDetails: vi.fn((...args: Parameters<typeof actual.getMovieDetails>) => actual.getMovieDetails(...args)),
  };
});

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MovieStoreProvider>{children}</MovieStoreProvider>
);

describe('MovieStore State & Race Resiliency', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    vi.restoreAllMocks();
  });

  const sampleMovie: Movie = {
    id: 100,
    title: 'Interstellar',
    overview: 'Space exploration masterpiece',
    release_date: '2014-11-07',
    vote_average: 8.6,
    vote_count: 30000,
    poster_path: null,
    backdrop_path: null,
    genres: [{ id: 878, name: 'Sci-Fi' }, { id: 18, name: 'Drama' }],
    director: 'Christopher Nolan',
  };

  it('keeps the storage warning visible for failed deletions until retry succeeds', () => {
    localStorage.setItem('blocked-delete', 'retained');
    const { result, unmount } = renderHook(() => useMovieStore(), { wrapper });
    const originalRemove = Storage.prototype.removeItem;
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
      if (key === 'blocked-delete') throw new Error('Deletion blocked');
      return originalRemove.call(this, key);
    });
    try {
      act(() => { safeRemoveItem('blocked-delete'); });
      expect(result.current.storageWarning).not.toBeNull();
      act(() => { safeSetItem('unrelated', 'saved'); });
      expect(result.current.storageWarning).not.toBeNull();
      act(() => { expect(retryPendingStorageChanges()).toBe(false); });
      expect(result.current.storageWarning).not.toBeNull();
      remove.mockRestore();
      act(() => { expect(retryPendingStorageChanges()).toBe(true); });
      expect(result.current.storageWarning).toBeNull();
      expect(localStorage.getItem('blocked-delete')).toBeNull();
    } finally {
      remove.mockRestore();
      unmount();
    }
  });

  it('sets rating immediately and calculates taste profile stats correctly', async () => {
    const { result } = renderHook(() => useMovieStore(), { wrapper });

    await act(async () => {
      await result.current.setRating(sampleMovie, 10);
    });

    expect(result.current.ratings[100]).toBeDefined();
    expect(result.current.ratings[100].rating).toBe(10);
    expect(result.current.tasteStats.totalRated).toBe(1);
    expect(result.current.tasteStats.averageRating).toBe(10);
    expect(result.current.tasteStats.topGenres[0].genre).toBe('Sci-Fi');
    expect(result.current.tasteStats.topDirectors[0].director).toBe('Christopher Nolan');

    // Verify persisted in storage
    const stored = safeGetItem(STORAGE_KEYS.RATINGS);
    expect(stored).toBeDefined();
    expect(JSON.parse(stored!)[100].title).toBe('Interstellar');
  });

  it('removes rating when rating <= 0 or when removeRating is called', async () => {
    const { result } = renderHook(() => useMovieStore(), { wrapper });

    await act(async () => {
      await result.current.setRating(sampleMovie, 8);
    });
    expect(result.current.ratings[100]).toBeDefined();

    await act(async () => {
      await result.current.setRating(sampleMovie, 0);
    });
    expect(result.current.ratings[100]).toBeUndefined();
    expect(result.current.tasteStats.totalRated).toBe(0);
  });

  it('toggles watchlist items atomically without duplicates', () => {
    const { result } = renderHook(() => useMovieStore(), { wrapper });

    act(() => {
      result.current.toggleWatchlist(sampleMovie);
    });
    expect(result.current.watchlist).toContain(100);
    expect(result.current.watchlistMovies[100].title).toBe('Interstellar');

    // Toggle off
    act(() => {
      result.current.toggleWatchlist(sampleMovie);
    });
    expect(result.current.watchlist).not.toContain(100);
    expect(result.current.watchlistMovies[100]).toBeUndefined();
  });

  it('clearAllData invalidates all state and clears storage', async () => {
    const { result } = renderHook(() => useMovieStore(), { wrapper });

    await act(async () => {
      await result.current.setRating(sampleMovie, 9);
      result.current.toggleWatchlist(sampleMovie);
    });

    act(() => {
      result.current.clearAllData();
    });

    expect(Object.keys(result.current.ratings).length).toBe(0);
    expect(result.current.watchlist.length).toBe(0);
    expect(result.current.recommendations.length).toBe(0);
    expect(JSON.parse(safeGetItem(STORAGE_KEYS.RATINGS) || '{}')).toEqual({});
    expect(JSON.parse(safeGetItem(STORAGE_KEYS.WATCHLIST) || '[]')).toEqual([]);
  });

  it('replaceRatingsList atomically overwrites all ratings and resets rating state', async () => {
    const { result } = renderHook(() => useMovieStore(), { wrapper });

    // Seed existing ratings
    await act(async () => {
      await result.current.setRating(sampleMovie, 10);
    });
    expect(result.current.ratings[100]).toBeDefined();

    // Replace with a completely new ratings list
    const replacementRating: UserRating = {
      movieId: 999,
      title: 'Arrival',
      rating: 9,
      genres: ['Sci-Fi', 'Drama'],
      ratedAt: Date.now(),
      posterPath: null,
    };

    act(() => {
      result.current.replaceRatingsList([replacementRating]);
    });

    // Old movie 100 must be gone; new movie 999 must exist
    expect(result.current.ratings[100]).toBeUndefined();
    expect(result.current.ratings[999]).toBeDefined();
    expect(result.current.ratings[999].title).toBe('Arrival');
    expect(result.current.tasteStats.totalRated).toBe(1);
    expect(result.current.tasteStats.averageRating).toBe(9);
  });

  it('updateAISettings cancels active recommendation generation', async () => {
    credentialStore.setTmdbCredential('api_key', 'test-tmdb-key');
    const { result } = renderHook(() => useMovieStore(), { wrapper });

    // Start generation (which sets isGeneratingRecs)
    act(() => {
      result.current.generateRankings().catch(() => {});
    });

    // When settings change mid-generation, generation should be cancelled
    act(() => {
      result.current.updateAISettings({ serendipityLevel: 80 });
    });

    expect(result.current.isGeneratingRecs).toBe(false);
  });

  it('credential change or forget cancels active recommendation generation', async () => {
    credentialStore.setTmdbCredential('api_key', 'test-tmdb-key');
    const { result } = renderHook(() => useMovieStore(), { wrapper });

    act(() => {
      result.current.generateRankings().catch(() => {});
    });

    // Rotating or forgetting credentials aborts generation
    act(() => {
      credentialStore.forgetAll();
    });

    expect(result.current.isGeneratingRecs).toBe(false);
  });

  it('delete-and-re-rate does not allow stale enrichment to overwrite new data', async () => {
    credentialStore.setTmdbCredential('api_key', 'test-tmdb-key');
    const { result } = renderHook(() => useMovieStore(), { wrapper });

    const movieWithoutDirector: Movie = {
      id: 200,
      title: 'Movie Without Director',
      overview: 'Test overview',
      release_date: '2020-01-01',
      vote_average: 7.5,
      vote_count: 100,
      poster_path: null,
      backdrop_path: null,
      genres: [{ id: 18, name: 'Drama' }],
    };

    // Deferred mock response to simulate an in-flight network lookup
    let resolveStaleDetails!: (movie: Movie) => void;
    const staleDetailsPromise = new Promise<Movie>((resolve) => {
      resolveStaleDetails = resolve;
    });

    vi.mocked(getMovieDetails).mockImplementationOnce(() => staleDetailsPromise);

    // 1. Initial rating without director triggers async enrichment
    let initialRatingPromise: Promise<void>;
    act(() => {
      initialRatingPromise = result.current.setRating(movieWithoutDirector, 8);
    });

    expect(result.current.ratings[200]).toBeDefined();
    expect(result.current.ratings[200].rating).toBe(8);
    expect(result.current.ratings[200].director).toBeUndefined();

    // 2. While enrichment request is still in-flight, delete the rating
    act(() => {
      result.current.removeRating(200);
    });
    expect(result.current.ratings[200]).toBeUndefined();

    // 3. Re-rate the same movie with an explicit new director
    const updatedMovie: Movie = {
      ...movieWithoutDirector,
      director: 'Denis Villeneuve',
    };
    await act(async () => {
      await result.current.setRating(updatedMovie, 9);
    });
    expect(result.current.ratings[200]).toBeDefined();
    expect(result.current.ratings[200].rating).toBe(9);
    expect(result.current.ratings[200].director).toBe('Denis Villeneuve');

    // 4. Now resolve the stale in-flight enrichment with old director
    await act(async () => {
      resolveStaleDetails({
        ...movieWithoutDirector,
        director: 'Old Stale Director',
        keywords: ['stale'],
      });
      await initialRatingPromise;
    });

    // 5. Stale enrichment must be rejected; director must remain Denis Villeneuve
    expect(result.current.ratings[200]).toBeDefined();
    expect(result.current.ratings[200].rating).toBe(9);
    expect(result.current.ratings[200].director).toBe('Denis Villeneuve');
    expect(result.current.ratings[200].director).not.toBe('Old Stale Director');
  });

  it('recovers legacy watchlist and watchlistMovies when v2 is empty and persists on reload', async () => {
    const legacyWatchlist = [101, 202];
    const legacyWatchlistMovies = {
      101: {
        id: 101,
        title: 'Legacy Movie 101',
        overview: '',
        poster_path: null,
        backdrop_path: null,
        release_date: '2020-01-01',
        vote_average: 8.0,
        vote_count: 100,
        genres: [],
      },
    };
    localStorage.setItem(STORAGE_KEYS.LEGACY_WATCHLIST, JSON.stringify(legacyWatchlist));
    localStorage.setItem(STORAGE_KEYS.LEGACY_WATCHLIST_MOVIES, JSON.stringify(legacyWatchlistMovies));
    localStorage.setItem(STORAGE_KEYS.WATCHLIST, '[]');
    localStorage.setItem(STORAGE_KEYS.WATCHLIST_MOVIES, '{}');

    // 1. App initialization: store should recover from legacy
    const { result, unmount } = renderHook(() => useMovieStore(), { wrapper });

    expect(result.current.watchlist).toEqual([101, 202]);
    expect(result.current.watchlistMovies[101]).toBeDefined();
    expect(result.current.watchlistMovies[101].title).toBe('Legacy Movie 101');

    // 2. Check that persistence saved to v2
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.WATCHLIST) || '[]')).toEqual([101, 202]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.WATCHLIST_MOVIES) || '{}')[101]?.title).toBe('Legacy Movie 101');

    unmount();

    // 3. Reload: render hook again; data should now load directly from v2
    const { result: reloaded } = renderHook(() => useMovieStore(), { wrapper });
    expect(reloaded.current.watchlist).toEqual([101, 202]);
    expect(reloaded.current.watchlistMovies[101]?.title).toBe('Legacy Movie 101');
  });

  it('failed migration -> recovery -> clearAllData -> fresh launch -> remains completely empty', () => {
    // 1. Migration fails because storage writes fail, leaving legacy ratings intact.
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
    localStorage.setItem(STORAGE_KEYS.LEGACY_WATCHLIST, JSON.stringify([101]));

    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === STORAGE_KEYS.RATINGS || key === STORAGE_KEYS.STORAGE_META) {
        throw new DOMException('Disk write failed', 'QuotaExceededError');
      }
      return originalSetItem.call(this, key, value);
    });

    const migrationRes = runStorageMigration();
    expect(migrationRes.migrated).toBe(false);
    expect(localStorage.getItem(STORAGE_KEYS.LEGACY_RATINGS)).toBe(legacyRatings);
    expect(localStorage.getItem(STORAGE_KEYS.STORAGE_META)).toBeNull();

    // 2. The app recovers those ratings into memory.
    vi.restoreAllMocks();

    const { result, unmount } = renderHook(() => useMovieStore(), { wrapper });
    expect(result.current.ratings[42]).toBeDefined();
    expect(result.current.ratings[42].title).toBe('The Shawshank Redemption');
    expect(result.current.watchlist).toContain(101);

    // 3. Storage becomes writable and the user selects Clear all data.
    act(() => {
      result.current.clearAllData();
    });

    expect(Object.keys(result.current.ratings).length).toBe(0);
    expect(result.current.watchlist.length).toBe(0);
    expect(localStorage.getItem(STORAGE_KEYS.LEGACY_RATINGS)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.LEGACY_WATCHLIST)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.STORAGE_META)).toBe('migrated_from_v1');

    unmount();

    // 4. On fresh relaunch, migration runs and app initializes
    const secondMigration = runStorageMigration();
    expect(secondMigration.migrated).toBe(false);

    // 5. App should still be completely empty; legacy data is NOT resurrected
    const { result: freshLaunch } = renderHook(() => useMovieStore(), { wrapper });
    expect(Object.keys(freshLaunch.current.ratings).length).toBe(0);
    expect(freshLaunch.current.watchlist.length).toBe(0);
    expect(freshLaunch.current.ratings[42]).toBeUndefined();
  });

  it('failed migration -> recovery -> clearWatchlist -> fresh launch -> watchlist remains empty', () => {
    localStorage.setItem(STORAGE_KEYS.LEGACY_WATCHLIST, JSON.stringify([101, 202]));
    localStorage.setItem(STORAGE_KEYS.LEGACY_WATCHLIST_MOVIES, JSON.stringify({ 101: { id: 101, title: 'Film 101' } }));

    const { result, unmount } = renderHook(() => useMovieStore(), { wrapper });
    expect(result.current.watchlist).toEqual([101, 202]);

    act(() => {
      result.current.clearWatchlist();
    });
    expect(result.current.watchlist.length).toBe(0);
    expect(localStorage.getItem(STORAGE_KEYS.LEGACY_WATCHLIST)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.LEGACY_WATCHLIST_MOVIES)).toBeNull();

    unmount();

    const { result: freshLaunch } = renderHook(() => useMovieStore(), { wrapper });
    expect(freshLaunch.current.watchlist).toEqual([]);
    expect(Object.keys(freshLaunch.current.watchlistMovies).length).toBe(0);
  });

  it('failed migration -> recovery -> removeRating -> fresh launch -> deleted rating stays deleted', () => {
    const legacyRatings = JSON.stringify({
      101: { movieId: 101, title: 'Film 101', rating: 8 },
      202: { movieId: 202, title: 'Film 202', rating: 9 },
    });
    localStorage.setItem(STORAGE_KEYS.LEGACY_RATINGS, legacyRatings);

    const { result, unmount } = renderHook(() => useMovieStore(), { wrapper });
    expect(result.current.ratings[101]).toBeDefined();
    expect(result.current.ratings[202]).toBeDefined();

    act(() => {
      result.current.removeRating(101);
    });
    expect(result.current.ratings[101]).toBeUndefined();
    expect(result.current.ratings[202]).toBeDefined();

    unmount();

    const { result: freshLaunch } = renderHook(() => useMovieStore(), { wrapper });
    expect(freshLaunch.current.ratings[101]).toBeUndefined();
    expect(freshLaunch.current.ratings[202]).toBeDefined();
  });

  it('failed migration -> recovery -> replaceRatingsList -> fresh launch -> only replaced ratings exist', () => {
    const legacyRatings = JSON.stringify({
      101: { movieId: 101, title: 'Old Film 101', rating: 6 },
    });
    localStorage.setItem(STORAGE_KEYS.LEGACY_RATINGS, legacyRatings);

    const { result, unmount } = renderHook(() => useMovieStore(), { wrapper });
    expect(result.current.ratings[101]).toBeDefined();

    const replacement: UserRating = {
      movieId: 999,
      title: 'New Imported Film',
      rating: 10,
      genres: [],
      ratedAt: Date.now(),
      posterPath: null,
    };

    act(() => {
      result.current.replaceRatingsList([replacement]);
    });
    expect(result.current.ratings[101]).toBeUndefined();
    expect(result.current.ratings[999]).toBeDefined();

    unmount();

    const { result: freshLaunch } = renderHook(() => useMovieStore(), { wrapper });
    expect(freshLaunch.current.ratings[101]).toBeUndefined();
    expect(freshLaunch.current.ratings[999]).toBeDefined();
  });
});
