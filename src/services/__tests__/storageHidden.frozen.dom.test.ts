// FROZEN acceptance tests for CIN-24 part 1. Do not edit or weaken.
// Interface contract: see header of src/store/__tests__/hiddenFilms.frozen.test.tsx.
// Storage: STORAGE_VERSION === 3; STORAGE_KEYS.HIDDEN_FILMS === 'cinematch_hidden_films_v3'.
import { describe, it, expect, beforeEach } from 'vitest';
import { STORAGE_KEYS, STORAGE_VERSION, runStorageMigration, safeGetItem, clearInMemoryStoreForTesting } from '../storage';

const ratings = {
  100: { movieId: 100, title: 'Interstellar', rating: 9, posterPath: null, genres: ['Sci-Fi'], keywords: [], ratedAt: 1700000000000 },
  200: { movieId: 200, title: 'Arrival', rating: 8, posterPath: null, genres: ['Drama'], keywords: [], ratedAt: 1700000001000 },
};
const watchlist = [300, 400];
const watchlistMovies = {
  300: { id: 300, title: 'Heat', overview: '', poster_path: null, backdrop_path: null, release_date: '1995-12-15', vote_average: 8, vote_count: 10, genres: [] },
  400: { id: 400, title: 'Alien', overview: '', poster_path: null, backdrop_path: null, release_date: '1979-05-25', vote_average: 8, vote_count: 10, genres: [] },
};
const settings = { activeProvider: 'gemini', geminiModel: 'gemini-3.8-flash', openRouterModel: 'x', serendipityLevel: 55, selectedVibes: ['dark'], preferredEras: ['1990s'] };

describe('CIN-24 AC1 storage schema v3 migration', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
  });

  it('AC1: schema version is bumped to 3 and hidden films has its own key', () => {
    expect(STORAGE_VERSION).toBe(3);
    expect(STORAGE_KEYS.HIDDEN_FILMS).toBe('cinematch_hidden_films_v3');
  });

  for (const withMeta of [false, true]) {
    it(`AC1: migrating existing v2 data (meta=${withMeta}) preserves everything and starts with an empty hidden list`, () => {
      const seed: Record<string, string> = {
        [STORAGE_KEYS.RATINGS]: JSON.stringify(ratings),
        [STORAGE_KEYS.WATCHLIST]: JSON.stringify(watchlist),
        [STORAGE_KEYS.WATCHLIST_MOVIES]: JSON.stringify(watchlistMovies),
        [STORAGE_KEYS.SETTINGS]: JSON.stringify(settings),
      };
      if (withMeta) seed[STORAGE_KEYS.STORAGE_META] = 'migrated_from_v1';
      for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);

      runStorageMigration();

      for (const key of [STORAGE_KEYS.RATINGS, STORAGE_KEYS.WATCHLIST, STORAGE_KEYS.WATCHLIST_MOVIES, STORAGE_KEYS.SETTINGS]) {
        expect(safeGetItem(key)).toBe(seed[key]);
      }
      const hidden = safeGetItem(STORAGE_KEYS.HIDDEN_FILMS);
      expect(hidden === null ? [] : JSON.parse(hidden)).toEqual([]);
    });
  }
});
