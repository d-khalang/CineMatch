import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../../../test/mocks/server';
import { credentialStore } from '../../credentialStore';
import { clearTmdbCache, getCandidateRecommendationPool } from '../../tmdb';
import {
  generateCandidates,
  selectWeightedSeeds,
  getTopUserGenreIds,
  RequestLimiter,
} from '../candidateSources';
import type { UserRating } from '../../../types';

function createLcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function create200RatingFixture(): UserRating[] {
  const genresList = ['Action', 'Drama', 'Sci-Fi', 'Comedy', 'Thriller', 'Horror', 'Romance', 'Crime'];
  return Array.from({ length: 200 }, (_, i) => ({
    movieId: i + 1,
    title: `Rated Film ${i + 1}`,
    rating: 7 + (i % 4), // ratings between 7 and 10
    posterPath: `/rated_poster_${i + 1}.jpg`,
    genres: [genresList[i % genresList.length], genresList[(i + 1) % genresList.length]],
    ratedAt: 1600000000000 + i * 86400000,
  }));
}

describe('candidateSources module', () => {
  beforeEach(() => {
    credentialStore.setTmdbCredential('read_access_token', 'mock-token');
    clearTmdbCache();
    vi.restoreAllMocks();
  });

  describe('selectWeightedSeeds', () => {
    it('returns all items if eligible count <= requested count', () => {
      const items: UserRating[] = [
        { movieId: 1, title: 'A', rating: 8, posterPath: null, genres: [], ratedAt: 1000 },
        { movieId: 2, title: 'B', rating: 9, posterPath: null, genres: [], ratedAt: 2000 },
      ];
      const selected = selectWeightedSeeds(items, 5);
      expect(selected).toHaveLength(2);
      expect(selected.map((s) => s.movieId)).toEqual([1, 2]);
    });

    it('is strictly deterministic given identical injected random function', () => {
      const fixture = create200RatingFixture();
      const run1 = selectWeightedSeeds(fixture, 10, createLcg(12345));
      const run2 = selectWeightedSeeds(fixture, 10, createLcg(12345));

      expect(run1.map((r) => r.movieId)).toEqual(run2.map((r) => r.movieId));
    });

    it('rotates seed selection when random function differs', () => {
      const fixture = create200RatingFixture();
      const runA = selectWeightedSeeds(fixture, 10, createLcg(11111));
      const runB = selectWeightedSeeds(fixture, 10, createLcg(99999));

      expect(runA.map((r) => r.movieId)).not.toEqual(runB.map((r) => r.movieId));
    });

    it('weights higher ratings and recency more heavily on average', () => {
      const lowOld: UserRating = {
        movieId: 1,
        title: 'Old Low',
        rating: 7,
        posterPath: null,
        genres: [],
        ratedAt: 1000,
      };
      const highNew: UserRating = {
        movieId: 2,
        title: 'New High',
        rating: 10,
        posterPath: null,
        genres: [],
        ratedAt: 1000000,
      };
      const items = [lowOld, highNew];

      let highNewFirstCount = 0;
      const rng = createLcg(42);
      for (let i = 0; i < 100; i++) {
        const sel = selectWeightedSeeds(items, 1, rng);
        if (sel[0].movieId === 2) highNewFirstCount++;
      }

      // High+new rating has weight (4 * 1.0 = 4.0) vs low+old (1 * 0.5 = 0.5), ratio 8:1
      expect(highNewFirstCount).toBeGreaterThan(70);
    });

    it('ignores ratings without ratedAt in recency weighting instead of treating them as 0', () => {
      const withoutTime = {
        movieId: 1,
        title: 'No Time',
        rating: 10,
        posterPath: null,
        genres: [],
      } as unknown as UserRating;
      const oldWithTime: UserRating = {
        movieId: 2,
        title: 'Old',
        rating: 10,
        posterPath: null,
        genres: [],
        ratedAt: 1000,
      };
      const newWithTime: UserRating = {
        movieId: 3,
        title: 'New',
        rating: 10,
        posterPath: null,
        genres: [],
        ratedAt: 2000,
      };

      const items = [withoutTime, oldWithTime, newWithTime];
      const selected = selectWeightedSeeds(items, 3);
      expect(selected).toHaveLength(3);
    });

    it('uses reduce and handles large ratings arrays without call stack overflow', () => {
      const largeFixture: UserRating[] = Array.from({ length: 150000 }, (_, i) => ({
        movieId: i + 1,
        title: `Movie ${i + 1}`,
        rating: 8,
        posterPath: null,
        genres: [],
        ratedAt: 1600000000000 + i * 1000,
      }));

      expect(() => selectWeightedSeeds(largeFixture, 5)).not.toThrow();
    });
  });

  describe('getTopUserGenreIds', () => {
    it('identifies top 3 genres from user ratings', () => {
      const ratings: UserRating[] = [
        { movieId: 1, title: 'A', rating: 9, posterPath: null, genres: ['Action', 'Sci-Fi'], ratedAt: 100 },
        { movieId: 2, title: 'B', rating: 9, posterPath: null, genres: ['Action', 'Drama'], ratedAt: 200 },
        { movieId: 3, title: 'C', rating: 8, posterPath: null, genres: ['Drama', 'Sci-Fi'], ratedAt: 300 },
        { movieId: 4, title: 'D', rating: 7, posterPath: null, genres: ['Comedy'], ratedAt: 400 },
      ];

      const top = getTopUserGenreIds(ratings);
      expect(top).toHaveLength(3);
      // Action: 28, Sci-Fi: 878, Drama: 18
      expect(top).toContain(28);
      expect(top).toContain(878);
      expect(top).toContain(18);
    });

    it('falls back to provided genres when user ratings have fewer than 3 genres', () => {
      const ratings: UserRating[] = [
        { movieId: 1, title: 'A', rating: 9, posterPath: null, genres: ['Action'], ratedAt: 100 },
      ];
      const top = getTopUserGenreIds(ratings, [18, 878]);
      expect(top).toEqual([28, 18, 878]);
    });

    it('weights top genres by liked ratings (>= 7) and ignores ratings < 7', () => {
      const ratings: UserRating[] = [
        { movieId: 1, title: 'Bad Horror 1', rating: 2, posterPath: null, genres: ['Horror'], ratedAt: 100 },
        { movieId: 2, title: 'Bad Horror 2', rating: 3, posterPath: null, genres: ['Horror'], ratedAt: 200 },
        { movieId: 3, title: 'Bad Horror 3', rating: 4, posterPath: null, genres: ['Horror'], ratedAt: 300 },
        { movieId: 4, title: 'Bad Horror 4', rating: 5, posterPath: null, genres: ['Horror'], ratedAt: 400 },
        { movieId: 5, title: 'Great Drama', rating: 9, posterPath: null, genres: ['Drama'], ratedAt: 500 },
        { movieId: 6, title: 'Great Sci-Fi', rating: 10, posterPath: null, genres: ['Sci-Fi'], ratedAt: 600 },
      ];

      const top = getTopUserGenreIds(ratings);
      // Horror (27) must not be in top genres because all its ratings were < 7
      expect(top).not.toContain(27);
      expect(top).toContain(18); // Drama
      expect(top).toContain(878); // Sci-Fi
    });
  });

  describe('RequestLimiter concurrency & ceiling', () => {
    it('enforces maximum 6 in flight and at most 45 total requests', async () => {
      const limiter = new RequestLimiter(undefined, 6, 45);
      let inFlight = 0;
      let maxInFlight = 0;
      let completed = 0;

      const tasks = Array.from({ length: 60 }, (_, i) => async () => {
        return limiter.schedule(async () => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight--;
          completed++;
          return i;
        });
      });

      const results = await Promise.all(tasks.map((t) => t()));
      const executed = results.filter((r) => r !== null);

      expect(maxInFlight).toBeLessThanOrEqual(6);
      expect(executed.length).toBe(45);
      expect(limiter.totalExecuted).toBe(45);
      expect(completed).toBe(45);
    });

    it('stops outstanding work immediately and rejects on abort', async () => {
      const controller = new AbortController();
      const limiter = new RequestLimiter(controller.signal, 6, 45);

      const promise = limiter.schedule(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'done';
      });

      controller.abort();
      await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    });
  });

  describe('generateCandidates multi-source generation', () => {
    it('produces at least 150 unrated, deduplicated candidates with a 200-rating fixture', async () => {
      const fixture = create200RatingFixture();

      // Mock MSW to return plenty of unrated candidates for seeds, hidden gems, and baseline
      server.use(
        http.get('https://api.themoviedb.org/3/movie/:id/recommendations', ({ params, request }) => {
          const url = new URL(request.url);
          const page = Number(url.searchParams.get('page') || '1');
          const seedId = Number(params.id);
          const results = Array.from({ length: 20 }, (_, idx) => {
            const candidateId = 1000 + seedId * 50 + (page - 1) * 20 + idx;
            return {
              id: candidateId,
              title: `Rec Movie ${candidateId}`,
              poster_path: `/rec_poster_${candidateId}.jpg`,
              backdrop_path: `/rec_backdrop_${candidateId}.jpg`,
              release_date: '2021-01-01',
              vote_average: 8.0,
              vote_count: 600,
              genre_ids: [28, 878],
            };
          });

          // Inject 1 rated movie to verify it is filtered out
          if (page === 1) {
            results[0] = {
              id: 1, // Rated movie ID!
              title: 'Rated Film 1',
              poster_path: '/rated_1.jpg',
              backdrop_path: "/rated_1_backdrop.jpg",
              release_date: '2020-01-01',
              vote_average: 8.0,
              vote_count: 500,
              genre_ids: [28],
            };
          }

          return HttpResponse.json({ page, results, total_pages: 5, total_results: 100 });
        }),

        http.get('https://api.themoviedb.org/3/movie/:id/similar', ({ params, request }) => {
          const url = new URL(request.url);
          const page = Number(url.searchParams.get('page') || '1');
          const seedId = Number(params.id);
          const results = Array.from({ length: 20 }, (_, idx) => {
            const candidateId = 5000 + seedId * 50 + (page - 1) * 20 + idx;
            return {
              id: candidateId,
              title: `Similar Movie ${candidateId}`,
              poster_path: idx === 19 ? null : `/sim_poster_${candidateId}.jpg`, // 1 without poster to verify filtering
              backdrop_path: null,
              release_date: '2020-05-01',
              vote_average: 7.8,
              vote_count: 400,
              genre_ids: [18],
            };
          });
          return HttpResponse.json({ page, results, total_pages: 5, total_results: 100 });
        }),

        http.get('https://api.themoviedb.org/3/discover/movie', ({ request }) => {
          const url = new URL(request.url);
          const page = Number(url.searchParams.get('page') || '1');
          const withGenres = url.searchParams.get('with_genres');
          const isHiddenGem = url.searchParams.get('vote_count.lte') === '800';

          const prefix = isHiddenGem ? 10000 + Number(withGenres || 1) * 100 : 20000;
          const results = Array.from({ length: 20 }, (_, idx) => {
            const candidateId = prefix + (page - 1) * 20 + idx;
            return {
              id: candidateId,
              title: `Discover Movie ${candidateId}`,
              poster_path: `/disc_poster_${candidateId}.jpg`,
              backdrop_path: null,
              release_date: '2019-01-01',
              vote_average: 7.9,
              vote_count: 350,
              genre_ids: withGenres ? [Number(withGenres)] : [18],
            };
          });

          return HttpResponse.json({ page, results, total_pages: 5, total_results: 100 });
        }),

        http.get('https://api.themoviedb.org/3/trending/movie/:timeWindow', () => {
          const results = Array.from({ length: 20 }, (_, idx) => {
            const candidateId = 30000 + idx;
            return {
              id: candidateId,
              title: `Trending Movie ${candidateId}`,
              poster_path: `/trend_poster_${candidateId}.jpg`,
              backdrop_path: null,
              release_date: '2023-01-01',
              vote_average: 8.1,
              vote_count: 1000,
              genre_ids: [28],
            };
          });
          return HttpResponse.json({ page: 1, results, total_pages: 1, total_results: 20 });
        })
      );

      const candidates = await generateCandidates(fixture, {
        randomFn: createLcg(42),
      });

      // 1. Verify count requirement: at least 150 candidates
      expect(candidates.length).toBeGreaterThanOrEqual(150);

      // 2. Verify deduplication
      const candidateIds = candidates.map((c) => c.movie.id);
      expect(new Set(candidateIds).size).toBe(candidates.length);

      // 3. Verify no rated films in candidates
      const ratedIdsSet = new Set(fixture.map((r) => r.movieId));
      for (const id of candidateIds) {
        expect(ratedIdsSet.has(id)).toBe(false);
      }

      // 4. Verify no films without posters
      for (const c of candidates) {
        expect(c.movie.poster_path).toBeTruthy();
      }
    });

    it('correctly assigns sources and seedNeighbour values and merges duplicates', async () => {
      const fixture: UserRating[] = [
        {
          movieId: 10,
          title: 'Loved Seed',
          rating: 10,
          posterPath: '/seed.jpg',
          genres: ['Action'],
          ratedAt: Date.now(),
        },
      ];

      server.use(
        http.get('https://api.themoviedb.org/3/movie/:id/recommendations', () => {
          return HttpResponse.json({
            page: 1,
            results: [
              {
                id: 501,
                title: 'Seed Rec Film',
                poster_path: '/p501.jpg',
                vote_average: 8.5,
                vote_count: 500,
                genre_ids: [28],
              },
              {
                id: 777,
                title: 'Cross-Source Film',
                poster_path: '/p777.jpg',
                vote_average: 8.0,
                vote_count: 300,
                genre_ids: [28],
              },
            ],
            total_pages: 1,
            total_results: 2,
          });
        }),

        http.get('https://api.themoviedb.org/3/movie/:id/similar', () => {
          return HttpResponse.json({ page: 1, results: [], total_pages: 1, total_results: 0 });
        }),

        http.get('https://api.themoviedb.org/3/discover/movie', ({ request }) => {
          const url = new URL(request.url);
          const isHiddenGem = url.searchParams.get('vote_count.lte') === '800';

          if (isHiddenGem) {
            return HttpResponse.json({
              page: 1,
              results: [
                {
                  id: 601,
                  title: 'Pure Hidden Gem',
                  poster_path: '/p601.jpg',
                  vote_average: 7.9,
                  vote_count: 150,
                  genre_ids: [28],
                },
                {
                  id: 777, // Overlaps with seed rec!
                  title: 'Cross-Source Film',
                  poster_path: '/p777.jpg',
                  vote_average: 8.0,
                  vote_count: 300,
                  genre_ids: [28],
                },
              ],
              total_pages: 1,
              total_results: 2,
            });
          }

          // Baseline discover
          return HttpResponse.json({
            page: 1,
            results: [
              {
                id: 701,
                title: 'Baseline Film',
                poster_path: '/p701.jpg',
                vote_average: 8.2,
                vote_count: 2000,
                genre_ids: [18],
              },
            ],
            total_pages: 1,
            total_results: 1,
          });
        }),

        http.get('https://api.themoviedb.org/3/trending/movie/:timeWindow', () => {
          return HttpResponse.json({ page: 1, results: [], total_pages: 1, total_results: 0 });
        })
      );

      const candidates = await generateCandidates(fixture, { seedCount: 1 });

      const c501 = candidates.find((c) => c.movie.id === 501);
      expect(c501).toBeDefined();
      expect(c501?.sources).toContain('seed_graph');
      expect(c501?.seedNeighbour).toBe(true);

      const c601 = candidates.find((c) => c.movie.id === 601);
      expect(c601).toBeDefined();
      expect(c601?.sources).toContain('hidden_gem');
      expect(c601?.seedNeighbour).toBe(false);

      const c701 = candidates.find((c) => c.movie.id === 701);
      expect(c701).toBeDefined();
      expect(c701?.sources).toContain('acclaimed_baseline');
      expect(c701?.seedNeighbour).toBe(false);

      // Overlapping film 777: must merge sources and preserve seedNeighbour = true
      const c777 = candidates.find((c) => c.movie.id === 777);
      expect(c777).toBeDefined();
      expect(c777?.sources).toContain('seed_graph');
      expect(c777?.sources).toContain('hidden_gem');
      expect(c777?.seedNeighbour).toBe(true);
    });

    it('asserts concurrency <= 6 and total requests <= 45 during generation', async () => {
      let activeRequests = 0;
      let maxActiveRequests = 0;
      let totalRequests = 0;
      const issuedUrls: string[] = [];

      const trackRequest = async (urlStr: string) => {
        issuedUrls.push(urlStr);
        activeRequests++;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        totalRequests++;
        await delay(15);
        activeRequests--;
      };

      server.use(
        http.get('https://api.themoviedb.org/3/movie/:id/recommendations', async ({ request }) => {
          await trackRequest(request.url);
          return HttpResponse.json({ page: 1, results: [], total_pages: 1, total_results: 0 });
        }),
        http.get('https://api.themoviedb.org/3/movie/:id/similar', async ({ request }) => {
          await trackRequest(request.url);
          return HttpResponse.json({ page: 1, results: [], total_pages: 1, total_results: 0 });
        }),
        http.get('https://api.themoviedb.org/3/discover/movie', async ({ request }) => {
          await trackRequest(request.url);
          return HttpResponse.json({ page: 1, results: [], total_pages: 1, total_results: 0 });
        }),
        http.get('https://api.themoviedb.org/3/trending/movie/:timeWindow', async ({ request }) => {
          await trackRequest(request.url);
          return HttpResponse.json({ page: 1, results: [], total_pages: 1, total_results: 0 });
        })
      );

      const fixture = create200RatingFixture();
      await generateCandidates(fixture, {
        seedCount: 12,
        preferredEras: ['80s', '90s'],
        selectedVibes: ['mind-bending', 'dark & gritty'],
      });

      expect(maxActiveRequests).toBeLessThanOrEqual(6);
      expect(totalRequests).toBeLessThanOrEqual(45);

      // Hidden gem requests (vote_count.lte=800): 3 top genres * 2 pages = 6 requests
      const hiddenGemRequests = issuedUrls.filter((u) => u.includes('vote_count.lte=800'));
      expect(hiddenGemRequests.length).toBe(6);

      // Every era query was issued: 2 eras * 3 queries = 6 queries
      const era80sQueries = issuedUrls.filter((u) => u.includes('1980-01-01'));
      expect(era80sQueries).toHaveLength(3);
      const era90sQueries = issuedUrls.filter((u) => u.includes('1990-01-01'));
      expect(era90sQueries).toHaveLength(3);

      // Every vibe query was issued: with_genres (2 queries) and with_keywords (1 query)
      expect(
        issuedUrls.some((u) => u.includes('vote_count.gte=600') && !u.includes('primary_release_date'))
      ).toBe(true);
      expect(
        issuedUrls.some((u) => u.includes('vote_count.gte=1000') && !u.includes('primary_release_date'))
      ).toBe(true);
      expect(issuedUrls.some((u) => u.includes('with_keywords='))).toBe(true);
    });

    it('stops outstanding work and rejects with an AbortError when aborted', async () => {
      const controller = new AbortController();
      let requestsStarted = 0;

      server.use(
        http.get('https://api.themoviedb.org/3/movie/:id/recommendations', async () => {
          requestsStarted++;
          await delay(50);
          return HttpResponse.json({ page: 1, results: [], total_pages: 1, total_results: 0 });
        }),
        http.get('https://api.themoviedb.org/3/movie/:id/similar', async () => {
          requestsStarted++;
          await delay(50);
          return HttpResponse.json({ page: 1, results: [], total_pages: 1, total_results: 0 });
        }),
        http.get('https://api.themoviedb.org/3/discover/movie', async () => {
          requestsStarted++;
          await delay(50);
          return HttpResponse.json({ page: 1, results: [], total_pages: 1, total_results: 0 });
        }),
        http.get('https://api.themoviedb.org/3/trending/movie/:timeWindow', async () => {
          requestsStarted++;
          await delay(50);
          return HttpResponse.json({ page: 1, results: [], total_pages: 1, total_results: 0 });
        })
      );

      // Pre-aborted signal
      const preAbortedController = new AbortController();
      preAbortedController.abort();
      await expect(generateCandidates([], {}, preAbortedController.signal)).rejects.toMatchObject({
        name: 'AbortError',
      });
      expect(requestsStarted).toBe(0);

      // Mid-flight abort
      const fixture = create200RatingFixture();
      const generationPromise = generateCandidates(fixture, {}, controller.signal);
      await delay(10);
      controller.abort();
      const requestsAfterAbort = requestsStarted;
      expect(requestsAfterAbort).toBeGreaterThan(0);

      await expect(generationPromise).rejects.toMatchObject({ name: 'AbortError' });
      await delay(100);
      expect(requestsStarted).toBe(requestsAfterAbort);
    });

    it('does not fail the whole pool if an individual TMDB query fails', async () => {
      const fixture: UserRating[] = [
        {
          movieId: 10,
          title: 'Seed Film',
          rating: 9,
          posterPath: '/p.jpg',
          genres: ['Action'],
          ratedAt: Date.now(),
        },
      ];

      server.use(
        // Seed recommendations fails with 500
        http.get('https://api.themoviedb.org/3/movie/:id/recommendations', () => {
          return new HttpResponse(null, { status: 500, statusText: 'Internal Error' });
        }),

        // Seed similar succeeds
        http.get('https://api.themoviedb.org/3/movie/:id/similar', () => {
          return HttpResponse.json({
            page: 1,
            results: [
              {
                id: 888,
                title: 'Surviving Similar Movie',
                poster_path: '/p888.jpg',
                vote_average: 8.0,
                vote_count: 200,
                genre_ids: [28],
              },
            ],
            total_pages: 1,
            total_results: 1,
          });
        }),

        http.get('https://api.themoviedb.org/3/discover/movie', () => {
          return HttpResponse.json({ page: 1, results: [], total_pages: 1, total_results: 0 });
        }),

        http.get('https://api.themoviedb.org/3/trending/movie/:timeWindow', () => {
          return HttpResponse.json({ page: 1, results: [], total_pages: 1, total_results: 0 });
        })
      );

      const candidates = await generateCandidates(fixture, { seedCount: 1 });
      expect(candidates).toHaveLength(1);
      expect(candidates[0].movie.id).toBe(888);
      expect(candidates[0].sources).toContain('seed_graph');
    });

    it('getCandidateRecommendationPool delegates to generateCandidates and preserves signature', async () => {
      server.use(
        http.get('https://api.themoviedb.org/3/movie/:id/recommendations', () => {
          return HttpResponse.json({
            page: 1,
            results: [
              {
                id: 888,
                title: 'Seed Rec Film',
                overview: 'Seed rec movie',
                poster_path: '/p888.jpg',
                backdrop_path: null,
                release_date: '2021-01-01',
                vote_average: 8.0,
                vote_count: 300,
                genre_ids: [18],
              },
            ],
            total_pages: 1,
            total_results: 1,
          });
        }),
        http.get('https://api.themoviedb.org/3/movie/:id/similar', () => {
          return HttpResponse.json({ page: 1, results: [], total_pages: 1, total_results: 0 });
        }),
        http.get('https://api.themoviedb.org/3/discover/movie', () => {
          return HttpResponse.json({
            page: 1,
            results: [
              {
                id: 999,
                title: 'Pool Candidate',
                overview: 'Candidate movie',
                poster_path: '/p999.jpg',
                backdrop_path: null,
                release_date: '2022-01-01',
                vote_average: 8.2,
                vote_count: 500,
                genre_ids: [18],
              },
            ],
            total_pages: 1,
            total_results: 1,
          });
        }),
        http.get('https://api.themoviedb.org/3/trending/movie/:timeWindow', () => {
          return HttpResponse.json({ page: 1, results: [], total_pages: 1, total_results: 0 });
        })
      );

      const userRatings: UserRating[] = [
        {
          movieId: 10,
          title: 'Seed Film 10',
          rating: 9,
          posterPath: '/seed10.jpg',
          genres: ['Drama'],
          ratedAt: 1600000000000,
        },
      ];

      const pool = await getCandidateRecommendationPool({
        userRatings,
        seedCount: 1,
      });

      expect(Array.isArray(pool)).toBe(true);
      const poolIds = pool.map((m) => m.id);
      expect(new Set(poolIds)).toEqual(new Set([888, 999]));

      const movie999 = pool.find((m) => m.id === 999);
      expect(movie999).toBeDefined();
      expect(movie999?.title).toBe('Pool Candidate');
      expect(movie999?.poster_path).toBe('/p999.jpg');
      expect(Array.isArray(movie999?.genres)).toBe(true);

      const movie888 = pool.find((m) => m.id === 888);
      expect(movie888).toBeDefined();
      expect(movie888?.title).toBe('Seed Rec Film');
      expect(movie888?.poster_path).toBe('/p888.jpg');
    });

    it('interleaves vibe-targeted streams ahead of the base stream and alongside era streams in the first 40 items', async () => {
      server.use(
        http.get('https://api.themoviedb.org/3/discover/movie', ({ request }) => {
          const url = new URL(request.url);
          const gte = url.searchParams.get('primary_release_date.gte');
          const withKeywords = url.searchParams.get('with_keywords');
          const withGenres = url.searchParams.get('with_genres');
          const isHiddenGem = url.searchParams.get('vote_count.lte') === '800';
          const voteCountGte = Number(url.searchParams.get('vote_count.gte') || 0);

          if (isHiddenGem) {
            return HttpResponse.json({
              page: 1,
              results: Array.from({ length: 20 }, (_, i) => ({
                id: 9000 + i,
                title: `Gem ${9000 + i}`,
                poster_path: `/g${9000 + i}.jpg`,
                release_date: '1992-01-01',
                vote_average: 7.6,
                vote_count: 200,
                genre_ids: [878],
              })),
            });
          }

          if (gte) {
            const year = Number(gte.slice(0, 4)) + 2;
            const base = (year - 1900) * 10000 + voteCountGte * 10;
            return HttpResponse.json({
              page: 1,
              results: Array.from({ length: 20 }, (_, i) => ({
                id: base + i,
                title: `Era ${year} #${i}`,
                poster_path: `/e${base + i}.jpg`,
                release_date: `${year}-05-01`,
                vote_average: 7.9,
                vote_count: 600,
                genre_ids: [878],
              })),
            });
          }

          if (withKeywords || withGenres) {
            const streamTag = withKeywords ? 'VibeKeyword' : `VibeGenre_${voteCountGte}`;
            const base = withKeywords ? 5000 : 3000 + voteCountGte;
            return HttpResponse.json({
              page: 1,
              results: Array.from({ length: 20 }, (_, i) => ({
                id: base + i,
                title: `${streamTag} ${base + i}`,
                poster_path: `/v${base + i}.jpg`,
                release_date: '1998-01-01',
                vote_average: 7.8,
                vote_count: 700,
                genre_ids: [878],
              })),
            });
          }

          const base = 7000 + voteCountGte;
          return HttpResponse.json({
            page: 1,
            results: Array.from({ length: 20 }, (_, i) => ({
              id: base + i,
              title: `Base ${base + i}`,
              poster_path: `/b${base + i}.jpg`,
              release_date: '1985-01-01',
              vote_average: 8.2,
              vote_count: 1500,
              genre_ids: [18],
            })),
          });
        }),
        http.get('https://api.themoviedb.org/3/trending/movie/:timeWindow', () =>
          HttpResponse.json({ page: 1, results: [] })
        )
      );

      // 1. Vibe-only: all 3 vibe streams appear before the first Base item
      const vibeOnly = await generateCandidates([], {
        selectedVibes: ['mind-bending'],
      });

      expect(vibeOnly.slice(0, 3).map((c) => c.movie.title)).toEqual([
        'VibeGenre_600 3600',
        'VibeGenre_1000 4000',
        'VibeKeyword 5000',
      ]);
      expect(vibeOnly[3].movie.title).toContain('Base');

      // 2. Combined eras + vibes: both era streams and vibe streams reach the 40-item AI window ahead of base
      clearTmdbCache();
      const combined = await generateCandidates([], {
        preferredEras: ['2000s', '2010s'],
        selectedVibes: ['mind-bending'],
      });
      const first40 = combined.slice(0, 40);
      expect(first40).toHaveLength(40);
      expect(first40.some((c) => c.movie.title.startsWith('Era 2002'))).toBe(true);
      expect(first40.some((c) => c.movie.title.startsWith('Era 2012'))).toBe(true);
      expect(first40.some((c) => c.movie.title.startsWith('VibeGenre_600'))).toBe(true);
      expect(first40.some((c) => c.movie.title.startsWith('VibeKeyword'))).toBe(true);
    });
  });
});
