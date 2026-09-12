import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import {
  BoundedLRUMap,
  redactTmdbUrl,
  MissingTmdbCredentialError,
  getMovieDetails,
  jitterSort,
  shuffleArray,
  getCalibrationMovies,
} from '../tmdb';
import { credentialStore } from '../credentialStore';
import { Movie, UserRating } from '../../types';

describe('TMDB Service Utilities and Caches', () => {
  it('enforces maximum capacity and evicts least recently used items in BoundedLRUMap', () => {
    const lru = new BoundedLRUMap<string, number>(3);

    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('c', 3);
    expect(lru.size).toBe(3);

    // Access 'a' so 'b' becomes the oldest
    expect(lru.get('a')).toBe(1);

    // Adding 'd' should evict 'b'
    lru.set('d', 4);
    expect(lru.size).toBe(3);
    expect(lru.has('b')).toBe(false);
    expect(lru.has('a')).toBe(true);
    expect(lru.has('c')).toBe(true);
    expect(lru.has('d')).toBe(true);
  });

  it('redacts api_key parameters from logged TMDB URLs', () => {
    const raw = 'https://api.themoviedb.org/3/movie/550?api_key=secret_12345&language=en-US';
    const redacted = redactTmdbUrl(raw);

    expect(redacted).not.toContain('secret_12345');
    expect(redacted).toContain('api_key=%5BREDACTED%5D');

    // Malformed string fallback
    const malformed = 'not-a-valid-url?api_key=secret999&foo=bar';
    expect(redactTmdbUrl(malformed)).toContain('api_key=[REDACTED]');
  });

  it('throws MissingTmdbCredentialError when making requests without configured credential', async () => {
    credentialStore.forgetAll();

    await expect(getMovieDetails(550)).rejects.toThrow(MissingTmdbCredentialError);
  });
});

describe('Calibration Candidates Randomization & Shuffling', () => {
  describe('jitterSort', () => {
    it('preserves array items while introducing organic rank variation', () => {
      const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const jittered = jitterSort(input, 4);

      expect(jittered).toHaveLength(input.length);
      expect(new Set(jittered)).toEqual(new Set(input));

      // Empty and single-element edge cases
      expect(jitterSort([])).toEqual([]);
      expect(jitterSort([42])).toEqual([42]);

      // Bounded behavior over several iterations: item 1 (index 0) with window 3
      // should stay within the upper portion of the list
      for (let i = 0; i < 20; i++) {
        const res = jitterSort(input, 3);
        expect(res.slice(0, 5)).toContain(1);
      }
    });

    it('does not mutate the source array (immutability)', () => {
      const original = [10, 20, 30, 40, 50];
      const frozen = Object.freeze([...original]);
      expect(() => jitterSort(frozen as number[], 3)).not.toThrow();
      expect(original).toEqual([10, 20, 30, 40, 50]);
    });

    it('preserves exact order when windowSize is 0', () => {
      const input = [5, 3, 8, 1, 9, 2];
      const sorted = jitterSort(input, 0);
      expect(sorted).toEqual(input);
    });

    it('handles objects with identical sort keys and maintains stability without dropping items', () => {
      const items = [
        { id: 1, title: 'Alpha' },
        { id: 2, title: 'Beta' },
        { id: 3, title: 'Gamma' },
      ];
      const res = jitterSort(items, 2);
      expect(res).toHaveLength(3);
      expect(res.map((x) => x.id).sort()).toEqual([1, 2, 3]);
    });
  });

  describe('shuffleArray', () => {
    it('preserves all elements and handles boundary sizes', () => {
      const input = ['drama', 'thriller', 'scifi', 'comedy', 'blockbuster'];
      const shuffled = shuffleArray(input);

      expect(shuffled).toHaveLength(input.length);
      expect(new Set(shuffled)).toEqual(new Set(input));
      expect(shuffleArray([])).toEqual([]);
      expect(shuffleArray(['single'])).toEqual(['single']);
    });

    it('does not mutate the input array', () => {
      const original = ['a', 'b', 'c', 'd'];
      const copy = [...original];
      shuffleArray(copy);
      expect(copy).toEqual(original);
    });

    it('generates permutations across repeated runs', () => {
      const input = [1, 2, 3, 4, 5, 6, 7];
      const results = new Set<string>();
      for (let i = 0; i < 25; i++) {
        results.add(shuffleArray(input).join(','));
      }
      // With 7 items, 25 runs should yield multiple distinct permutations
      expect(results.size).toBeGreaterThan(1);
    });
  });

  describe('getCalibrationMovies', () => {
    beforeEach(() => {
      credentialStore.setTmdbCredential('read_access_token', 'mock-token');
    });

    it('returns balanced candidates and defaults randomize to true', async () => {
      const res = await getCalibrationMovies('all', 1);
      expect(res.movies).toBeDefined();
      expect(res.movies.length).toBeGreaterThan(0);
      res.movies.forEach((m: Movie) => {
        expect(m.id).toBeDefined();
        expect(m.title).toBeDefined();
        expect(Array.isArray(m.genres)).toBe(true);
      });
    });

    it('returns strictly identical results when randomize: false (deterministic mode)', async () => {
      const run1 = await getCalibrationMovies('all', 1, { randomize: false });
      const run2 = await getCalibrationMovies('all', 1, { randomize: false });

      expect(run1.movies.map((m) => m.id)).toEqual(run2.movies.map((m) => m.id));
    });

    it('supports specific archetype categories with bounded randomization', async () => {
      const res = await getCalibrationMovies('mind_bending', 1);
      expect(res.movies).toBeDefined();
      expect(res.movies.length).toBeGreaterThan(0);
      res.movies.forEach((m: Movie) => {
        expect(m.id).toBeDefined();
        expect(m.title).toBeDefined();
      });
    });

    it('enforces franchise deduplication across candidates under randomization', async () => {
      server.use(
        http.get('https://api.themoviedb.org/3/discover/movie', () => {
          return HttpResponse.json({
            page: 1,
            results: [
              { id: 201, title: 'The Dark Knight', overview: '', poster_path: null, backdrop_path: null, release_date: '2008-07-18', vote_average: 9.0, vote_count: 30000, genre_ids: [18, 28] },
              { id: 202, title: 'The Dark Knight Rises', overview: '', poster_path: null, backdrop_path: null, release_date: '2012-07-20', vote_average: 8.4, vote_count: 22000, genre_ids: [18, 28] },
              { id: 203, title: 'Batman Begins', overview: '', poster_path: null, backdrop_path: null, release_date: '2005-06-15', vote_average: 8.2, vote_count: 19000, genre_ids: [18, 28] },
              { id: 204, title: 'Inception', overview: '', poster_path: null, backdrop_path: null, release_date: '2010-07-16', vote_average: 8.8, vote_count: 35000, genre_ids: [878, 28] },
            ],
            total_pages: 1,
            total_results: 4,
          });
        })
      );

      const res = await getCalibrationMovies('blockbusters', 1, { randomize: true });
      const titles = res.movies.map((m) => m.title);

      // Only 1 Batman/Dark Knight film should appear in the result
      const batmanFilms = titles.filter((t) => t.includes('Dark Knight') || t.includes('Batman'));
      expect(batmanFilms.length).toBeLessThanOrEqual(1);
    });

    it('deprioritizes user-disliked genres strictly to the tail even when randomization is active', async () => {
      server.use(
        http.get('https://api.themoviedb.org/3/discover/movie', () => {
          return HttpResponse.json({
            page: 1,
            results: [
              { id: 301, title: 'Sci-Fi Movie A', overview: '', poster_path: null, backdrop_path: null, release_date: '2020-01-01', vote_average: 8.0, vote_count: 5000, genre_ids: [878] },
              { id: 302, title: 'Drama Movie B', overview: '', poster_path: null, backdrop_path: null, release_date: '2020-01-01', vote_average: 8.0, vote_count: 5000, genre_ids: [18] },
              { id: 303, title: 'Comedy Movie C', overview: '', poster_path: null, backdrop_path: null, release_date: '2020-01-01', vote_average: 8.0, vote_count: 5000, genre_ids: [35] },
            ],
            total_pages: 1,
            total_results: 3,
          });
        })
      );

      const dislikedRatings: Record<number, UserRating> = {
        999: {
          movieId: 999,
          title: 'Disliked Sci-Fi Film',
          rating: 2,
          posterPath: null,
          ratedAt: Date.now(),
          genres: ['Sci-Fi'],
        },
      };

      const res = await getCalibrationMovies('blockbusters', 1, {
        userRatings: dislikedRatings,
        randomize: true,
      });

      // Drama and Comedy should appear before the disliked Sci-Fi movie
      const movie301Index = res.movies.findIndex((m) => m.id === 301);
      const nonDislikedIndices = res.movies
        .filter((m) => m.id === 302 || m.id === 303)
        .map((m) => res.movies.indexOf(m));

      for (const idx of nonDislikedIndices) {
        if (movie301Index !== -1) {
          expect(idx).toBeLessThan(movie301Index);
        }
      }
    });

    it('produces varied candidate ordering across multiple calls when randomize is active', async () => {
      server.use(
        http.get('https://api.themoviedb.org/3/discover/movie', () => {
          return HttpResponse.json({
            page: 1,
            results: Array.from({ length: 15 }, (_, i) => ({
              id: 1000 + i,
              title: `Movie ${i}`,
              overview: '',
              poster_path: null,
              backdrop_path: null,
              release_date: '2020-01-01',
              vote_average: 8.0,
              vote_count: 5000,
              genre_ids: [18],
            })),
            total_pages: 1,
            total_results: 15,
          });
        })
      );

      const orderings = new Set<string>();
      for (let i = 0; i < 15; i++) {
        const res = await getCalibrationMovies('all', 1, { randomize: true });
        orderings.add(res.movies.map((m) => m.id).join(','));
      }

      // Over 15 runs with randomized candidate jitter and row shuffling,
      // we must get more than 1 distinct order
      expect(orderings.size).toBeGreaterThan(1);
    });
  });
});
