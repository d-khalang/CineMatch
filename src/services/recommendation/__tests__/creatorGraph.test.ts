import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../../../test/mocks/server';
import { credentialStore } from '../../credentialStore';
import { clearTmdbCache } from '../../tmdb';
import { generateCandidates, clearCreatorGraphCache } from '../candidateSources';
import type { UserRating } from '../../../types';

function makeRating(
  movieId: number,
  rating: number,
  ratedAt: number,
  genres: string[] = ['Drama']
): UserRating {
  return {
    movieId,
    title: `Rated Film ${movieId}`,
    rating,
    posterPath: `/rated_${movieId}.jpg`,
    genres,
    ratedAt,
  };
}

describe('creatorGraph candidate source', () => {
  beforeEach(() => {
    credentialStore.setTmdbCredential('read_access_token', 'mock-token');
    clearTmdbCache();
    clearCreatorGraphCache();
    vi.restoreAllMocks();
  });

  it('tags loved creator films as creator_graph, merges with seed_graph without duplicating sources, and filters crew jobs/posters/votes', async () => {
    const requestedPersonIds: number[] = [];
    const ratings: UserRating[] = [
      makeRating(101, 10, 1000, ['Drama']),
      makeRating(102, 9, 2000, ['Sci-Fi']),
      makeRating(103, 8, 3000, ['Thriller']),
    ];

    server.use(
      http.get('https://api.themoviedb.org/3/movie/:id/recommendations', ({ params }) => {
        if (Number(params.id) === 101) {
          return HttpResponse.json({
            page: 1,
            results: [
              {
                id: 777,
                title: 'Shared Seed & Creator Film',
                poster_path: '/p777.jpg',
                vote_average: 8.4,
                vote_count: 500,
                genre_ids: [18],
              },
              {
                id: 778,
                title: 'Seed Only Film',
                poster_path: '/p778.jpg',
                vote_average: 7.9,
                vote_count: 300,
                genre_ids: [18],
              },
            ],
          });
        }
        return HttpResponse.json({ page: 1, results: [] });
      }),

      http.get('https://api.themoviedb.org/3/movie/:id/similar', () => {
        return HttpResponse.json({ page: 1, results: [] });
      }),

      http.get('https://api.themoviedb.org/3/discover/movie', () => {
        return HttpResponse.json({ page: 1, results: [] });
      }),

      http.get('https://api.themoviedb.org/3/trending/movie/:timeWindow', () => {
        return HttpResponse.json({ page: 1, results: [] });
      }),

      http.get('https://api.themoviedb.org/3/movie/:id/credits', ({ params }) => {
        const id = Number(params.id);
        if (id === 101) {
          return HttpResponse.json({
            id,
            crew: [
              { id: 1001, name: 'Loved Director', job: 'Director' },
              { id: 1002, name: 'Ignored Producer', job: 'Producer' },
            ],
          });
        }
        if (id === 102) {
          return HttpResponse.json({
            id,
            crew: [{ id: 1003, name: 'Loved Screenwriter', job: 'Screenplay' }],
          });
        }
        return HttpResponse.json({
          id,
          crew: [{ id: 1004, name: 'Loved Writer', job: 'Writer' }],
        });
      }),

      http.get('https://api.themoviedb.org/3/person/:id/movie_credits', ({ params }) => {
        const personId = Number(params.id);
        requestedPersonIds.push(personId);
        if (personId === 1001) {
          return HttpResponse.json({
            id: personId,
            // Cast credits must be ignored even if they meet poster/vote thresholds
            cast: [
              {
                id: 9001,
                title: 'Cameo Film',
                poster_path: '/cameo.jpg',
                vote_count: 1000,
                vote_average: 8.0,
                genre_ids: [18],
              },
            ],
            crew: [
              {
                id: 5001,
                title: 'Director Other Film',
                poster_path: '/p5001.jpg',
                vote_count: 30, // Boundary: exact 30 should be included
                vote_average: 7.7,
                genre_ids: [18],
                job: 'Director',
              },
              // Duplicate movie entry under another allowed job should appear once
              {
                id: 5001,
                title: 'Director Other Film',
                poster_path: '/p5001.jpg',
                vote_count: 30,
                vote_average: 7.7,
                genre_ids: [18],
                job: 'Writer',
              },
              {
                id: 777, // Also returned by seed_graph
                title: 'Shared Seed & Creator Film',
                poster_path: '/p777.jpg',
                vote_count: 500,
                vote_average: 8.4,
                genre_ids: [18],
                job: 'Director',
              },
              {
                id: 5002,
                title: 'Too Few Votes Film',
                poster_path: '/p5002.jpg',
                vote_count: 29, // Below 30 -> excluded
                vote_average: 8.5,
                genre_ids: [18],
                job: 'Director',
              },
              {
                id: 5003,
                title: 'No Poster Film',
                poster_path: null, // No poster -> excluded
                vote_count: 400,
                vote_average: 8.1,
                genre_ids: [18],
                job: 'Director',
              },
              {
                id: 5004,
                title: 'Producer Only Credit',
                poster_path: '/p5004.jpg',
                vote_count: 800,
                vote_average: 8.0,
                genre_ids: [18],
                job: 'Producer', // Non-director/writer job -> excluded
              },
              {
                id: 102, // Already rated -> excluded
                title: 'Rated Film 102',
                poster_path: '/rated_102.jpg',
                vote_count: 900,
                vote_average: 9.0,
                genre_ids: [878],
                job: 'Director',
              },
              {
                id: 999, // In excludeIds -> excluded
                title: 'Excluded Film',
                poster_path: '/p999.jpg',
                vote_count: 500,
                vote_average: 8.0,
                genre_ids: [18],
                job: 'Director',
              },
              {
                id: 5005, // NaN vote_count -> excluded
                title: 'NaN Votes Film',
                poster_path: '/p5005.jpg',
                vote_count: Number.NaN,
                vote_average: 8.0,
                genre_ids: [18],
                job: 'Director',
              },
              {
                id: 5006, // Whitespace poster_path -> excluded
                title: 'Whitespace Poster Film',
                poster_path: '   ',
                vote_count: 500,
                vote_average: 8.0,
                genre_ids: [18],
                job: 'Director',
              },
            ],
          });
        }
        if (personId === 1003) {
          return HttpResponse.json({
            id: personId,
            crew: [
              {
                id: 5010,
                title: 'Screenwriter Other Film',
                poster_path: '/p5010.jpg',
                vote_count: 120,
                vote_average: 7.5,
                genre_ids: [878],
                job: 'Screenplay',
              },
            ],
          });
        }
        if (personId === 1004) {
          return HttpResponse.json({
            id: personId,
            crew: [
              {
                id: 5020,
                title: 'Writer Other Film',
                poster_path: '/p5020.jpg',
                vote_count: 45,
                vote_average: 7.6,
                genre_ids: [53],
                job: 'Writer',
              },
            ],
          });
        }
        return HttpResponse.json({ id: personId, crew: [] });
      })
    );

    const candidates = await generateCandidates(ratings, {
      seedCount: 3,
      excludeIds: new Set([999]),
    });

    const directorFilm = candidates.find((c) => c.movie.id === 5001);
    expect(directorFilm).toBeDefined();
    expect(directorFilm?.sources).toEqual(['creator_graph']);
    expect(directorFilm?.seedNeighbour).toBe(false);

    const screenplayFilm = candidates.find((c) => c.movie.id === 5010);
    expect(screenplayFilm).toBeDefined();
    expect(screenplayFilm?.sources).toEqual(['creator_graph']);
    expect(screenplayFilm?.seedNeighbour).toBe(false);

    const writerFilm = candidates.find((c) => c.movie.id === 5020);
    expect(writerFilm).toBeDefined();
    expect(writerFilm?.sources).toEqual(['creator_graph']);
    expect(writerFilm?.seedNeighbour).toBe(false);

    expect(requestedPersonIds).not.toContain(1002); // Producer on seed movie never queried

    const sharedFilm = candidates.find((c) => c.movie.id === 777);
    expect(sharedFilm).toBeDefined();
    expect(sharedFilm?.sources).toContain('seed_graph');
    expect(sharedFilm?.sources).toContain('creator_graph');
    expect(sharedFilm?.sources.filter((s) => s === 'creator_graph')).toHaveLength(1);
    expect(sharedFilm?.sources.filter((s) => s === 'seed_graph')).toHaveLength(1);
    expect(sharedFilm?.seedNeighbour).toBe(true);

    const seedOnly = candidates.find((c) => c.movie.id === 778);
    expect(seedOnly?.sources).toEqual(['seed_graph']);
    expect(seedOnly?.seedNeighbour).toBe(true);

    // Excluded items must not appear
    const ids = new Set(candidates.map((c) => c.movie.id));
    expect(ids.has(9001)).toBe(false); // cast credit
    expect(ids.has(5002)).toBe(false); // vote_count < 30
    expect(ids.has(5003)).toBe(false); // missing poster_path
    expect(ids.has(5004)).toBe(false); // Producer job
    expect(ids.has(5005)).toBe(false); // NaN vote_count
    expect(ids.has(5006)).toBe(false); // whitespace poster_path
    expect(ids.has(102)).toBe(false); // rated movie
    expect(ids.has(999)).toBe(false); // excludeIds
  });

  it('selects up to 6 highest-rated/newest films >= 8 and up to 8 distinct creators (directors first)', async () => {
    const requestedCreditMovieIds: number[] = [];
    const requestedPersonIds: number[] = [];

    // 8 films >= 8 plus 1 film rated 7 (must be ignored)
    const ratings: UserRating[] = [
      makeRating(1, 8, 100), // oldest 8 -> 7th overall (excluded)
      makeRating(2, 8, 500), // 3rd newest 8 -> 6th overall
      makeRating(3, 9, 200), // older 9 -> 4th overall
      makeRating(4, 9, 400), // newer 9 -> 3rd overall
      makeRating(5, 10, 100), // older 10 -> 2nd overall
      makeRating(6, 10, 300), // newest 10 -> 1st overall
      makeRating(7, 8, 700), // newest 8 -> 5th overall
      makeRating(8, 8, 250), // 2nd oldest 8 -> 8th overall (excluded)
      makeRating(9, 7, 9999), // rating < 8 -> ignored
    ];

    server.use(
      http.get('https://api.themoviedb.org/3/discover/movie', () =>
        HttpResponse.json({ page: 1, results: [] })
      ),
      http.get('https://api.themoviedb.org/3/trending/movie/:timeWindow', () =>
        HttpResponse.json({ page: 1, results: [] })
      ),
      http.get('https://api.themoviedb.org/3/movie/:id/recommendations', () =>
        HttpResponse.json({ page: 1, results: [] })
      ),
      http.get('https://api.themoviedb.org/3/movie/:id/similar', () =>
        HttpResponse.json({ page: 1, results: [] })
      ),
      http.get('https://api.themoviedb.org/3/movie/:id/credits', ({ params }) => {
        const movieId = Number(params.id);
        requestedCreditMovieIds.push(movieId);
        // Each of the 6 movies has 1 Writer (id 2000+movieId) and 1 Director (id 3000+movieId),
        // plus movie 5 shares director 3006 so there are 5 unique directors + 6 unique writers = 11 total.
        const directorId = movieId === 5 ? 3006 : 3000 + movieId;
        return HttpResponse.json({
          id: movieId,
          crew: [
            { id: 2000 + movieId, name: `Writer ${movieId}`, job: 'Writer' },
            { id: directorId, name: `Director ${directorId}`, job: 'Director' },
          ],
        });
      }),
      http.get('https://api.themoviedb.org/3/person/:id/movie_credits', ({ params }) => {
        requestedPersonIds.push(Number(params.id));
        return HttpResponse.json({ id: Number(params.id), crew: [] });
      })
    );

    await generateCandidates(ratings, { seedCount: 0 });

    // Top 6: 10s (6, 5), 9s (4, 3), newest 8s (7, 2)
    expect(requestedCreditMovieIds).toHaveLength(6);
    expect(new Set(requestedCreditMovieIds)).toEqual(new Set([6, 5, 4, 3, 7, 2]));
    expect(requestedCreditMovieIds).not.toContain(1);
    expect(requestedCreditMovieIds).not.toContain(8);
    expect(requestedCreditMovieIds).not.toContain(9);

    // 8 distinct creators: all 5 directors (3006, 3004, 3003, 3007, 3002) first, then top 3 writers (2006, 2005, 2004)
    expect(requestedPersonIds).toHaveLength(8);
    expect(new Set(requestedPersonIds)).toEqual(
      new Set([3006, 3004, 3003, 3007, 3002, 2006, 2005, 2004])
    );
  });

  it('keeps total request count <= 45 and in-flight <= 6, scheduling creator graph after seed graph', async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    let totalRequests = 0;
    const orderLog: string[] = [];

    const trackRequest = async (label: string) => {
      orderLog.push(label);
      activeRequests++;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      totalRequests++;
      await delay(10);
      activeRequests--;
    };

    const ratings = Array.from({ length: 12 }, (_, i) =>
      makeRating(i + 1, 8 + (i % 3), 1000 + i * 100)
    );

    server.use(
      http.get('https://api.themoviedb.org/3/discover/movie', async () => {
        await trackRequest('discover');
        return HttpResponse.json({ page: 1, results: [] });
      }),
      http.get('https://api.themoviedb.org/3/trending/movie/:timeWindow', async () => {
        await trackRequest('trending');
        return HttpResponse.json({ page: 1, results: [] });
      }),
      http.get('https://api.themoviedb.org/3/movie/:id/recommendations', async () => {
        await trackRequest('seed_rec');
        return HttpResponse.json({ page: 1, results: [] });
      }),
      http.get('https://api.themoviedb.org/3/movie/:id/similar', async () => {
        await trackRequest('seed_sim');
        return HttpResponse.json({ page: 1, results: [] });
      }),
      http.get('https://api.themoviedb.org/3/movie/:id/credits', async ({ params }) => {
        const movieId = Number(params.id);
        await trackRequest('creator_movie_credits');
        return HttpResponse.json({
          id: movieId,
          crew: [
            { id: 100 + movieId, name: `Dir ${movieId}`, job: 'Director' },
            { id: 200 + movieId, name: `Writer ${movieId}`, job: 'Writer' },
          ],
        });
      }),
      http.get('https://api.themoviedb.org/3/person/:id/movie_credits', async ({ params }) => {
        const personId = Number(params.id);
        await trackRequest('creator_person_credits');
        return HttpResponse.json({
          id: personId,
          crew: [
            {
              id: 8000 + personId,
              title: `Creator Film ${personId}`,
              poster_path: `/c${personId}.jpg`,
              vote_count: 150,
              vote_average: 7.8,
              genre_ids: [18],
              job: 'Director',
            },
          ],
        });
      })
    );

    const candidates = await generateCandidates(ratings, {
      seedCount: 8,
      preferredEras: ['80s', '90s'],
      selectedVibes: ['mind-bending'],
    });

    expect(maxActiveRequests).toBeLessThanOrEqual(6);
    expect(totalRequests).toBeLessThanOrEqual(45);
    expect(orderLog).toContain('creator_movie_credits');
    expect(orderLog).toContain('creator_person_credits');
    expect(candidates.some((c) => c.sources.includes('creator_graph'))).toBe(true);

    // Every creator-graph request is scheduled after all seed-graph requests
    const lastSeedIndex = Math.max(
      orderLog.lastIndexOf('seed_rec'),
      orderLog.lastIndexOf('seed_sim')
    );
    const firstCreatorIndex = orderLog.findIndex((l) => l.startsWith('creator_'));
    expect(lastSeedIndex).toBeGreaterThan(-1);
    expect(firstCreatorIndex).toBeGreaterThan(lastSeedIndex);
  });

  it('cuts creator-graph requests first when deadline expires during seed graph', async () => {
    let creatorRequests = 0;

    const ratings = [
      makeRating(1, 9, 100),
      makeRating(2, 9, 200),
      makeRating(3, 9, 300),
    ];

    server.use(
      http.get('https://api.themoviedb.org/3/discover/movie', () =>
        HttpResponse.json({
          page: 1,
          results: [
            {
              id: 701,
              title: 'Fast Baseline Film',
              poster_path: '/fast.jpg',
              vote_count: 1000,
              vote_average: 8.1,
              genre_ids: [18],
            },
          ],
        })
      ),
      http.get('https://api.themoviedb.org/3/trending/movie/:timeWindow', () =>
        HttpResponse.json({ page: 1, results: [] })
      ),
      http.get('https://api.themoviedb.org/3/movie/:id/recommendations', async () => {
        await delay(60);
        return HttpResponse.json({ page: 1, results: [] });
      }),
      http.get('https://api.themoviedb.org/3/movie/:id/similar', async () => {
        await delay(60);
        return HttpResponse.json({ page: 1, results: [] });
      }),
      http.get('https://api.themoviedb.org/3/movie/:id/credits', () => {
        creatorRequests++;
        return HttpResponse.json({ id: 1, crew: [] });
      }),
      http.get('https://api.themoviedb.org/3/person/:id/movie_credits', () => {
        creatorRequests++;
        return HttpResponse.json({ id: 1, crew: [] });
      })
    );

    const candidates = await generateCandidates(ratings, {
      seedCount: 3,
      deadlineMs: 25,
    });

    expect(creatorRequests).toBe(0);
    expect(candidates.some((c) => c.movie.id === 701)).toBe(true);
  });

  it('makes no /credits or /person requests when fewer than 3 ratings >= 8 exist', async () => {
    let creatorRequests = 0;

    server.use(
      http.get('https://api.themoviedb.org/3/discover/movie', () =>
        HttpResponse.json({ page: 1, results: [] })
      ),
      http.get('https://api.themoviedb.org/3/trending/movie/:timeWindow', () =>
        HttpResponse.json({ page: 1, results: [] })
      ),
      http.get('https://api.themoviedb.org/3/movie/:id/recommendations', () =>
        HttpResponse.json({ page: 1, results: [] })
      ),
      http.get('https://api.themoviedb.org/3/movie/:id/similar', () =>
        HttpResponse.json({ page: 1, results: [] })
      ),
      http.get('https://api.themoviedb.org/3/movie/:id/credits', () => {
        creatorRequests++;
        return HttpResponse.json({ id: 1, crew: [{ id: 50, job: 'Director' }] });
      }),
      http.get('https://api.themoviedb.org/3/person/:id/movie_credits', () => {
        creatorRequests++;
        return HttpResponse.json({ id: 50, crew: [] });
      })
    );

    // Empty ratings
    await generateCandidates([]);
    expect(creatorRequests).toBe(0);

    // 0 ratings >= 8
    await generateCandidates([makeRating(1, 7, 100), makeRating(2, 6, 200)]);
    expect(creatorRequests).toBe(0);

    // 2 ratings >= 8 plus several 7s and a NaN rating
    await generateCandidates([
      makeRating(1, 10, 100),
      makeRating(2, 8, 200),
      makeRating(3, 7, 300),
      makeRating(4, 7, 400),
      makeRating(5, Number.NaN, 500),
    ]);
    expect(creatorRequests).toBe(0);

    // Duplicate movieId entries totaling 3 entries but only 2 distinct movies >= 8
    await generateCandidates([
      makeRating(1, 10, 100),
      makeRating(1, 9, 200),
      makeRating(2, 8, 300),
    ]);
    expect(creatorRequests).toBe(0);
  });

  it('still returns other sources when a /person or /credits request fails', async () => {
    const ratings: UserRating[] = [
      makeRating(1, 9, 100),
      makeRating(2, 9, 200),
      makeRating(3, 8, 300),
    ];

    server.use(
      http.get('https://api.themoviedb.org/3/discover/movie', () =>
        HttpResponse.json({
          page: 1,
          results: [
            {
              id: 700,
              title: 'Baseline Film',
              poster_path: '/base700.jpg',
              vote_count: 1500,
              vote_average: 8.2,
              genre_ids: [18],
            },
          ],
        })
      ),
      http.get('https://api.themoviedb.org/3/trending/movie/:timeWindow', () =>
        HttpResponse.json({ page: 1, results: [] })
      ),
      http.get('https://api.themoviedb.org/3/movie/:id/recommendations', () =>
        HttpResponse.json({ page: 1, results: [] })
      ),
      http.get('https://api.themoviedb.org/3/movie/:id/similar', () =>
        HttpResponse.json({ page: 1, results: [] })
      ),
      http.get('https://api.themoviedb.org/3/movie/:id/credits', ({ params }) => {
        const id = Number(params.id);
        if (id === 3) {
          return new HttpResponse(null, { status: 500, statusText: 'Server Error' });
        }
        return HttpResponse.json({
          id,
          crew: [{ id: 400 + id, name: `Director ${id}`, job: 'Director' }],
        });
      }),
      http.get('https://api.themoviedb.org/3/person/:id/movie_credits', ({ params }) => {
        const personId = Number(params.id);
        if (personId === 401) {
          return new HttpResponse(null, { status: 500, statusText: 'Server Error' });
        }
        return HttpResponse.json({
          id: personId,
          crew: [
            {
              id: 8800 + personId,
              title: 'Surviving Creator Film',
              poster_path: '/surviving.jpg',
              vote_count: 250,
              vote_average: 7.9,
              genre_ids: [18],
              job: 'Director',
            },
          ],
        });
      })
    );

    const candidates = await generateCandidates(ratings, { seedCount: 0 });
    const ids = candidates.map((c) => c.movie.id);
    expect(ids).toContain(700);
    expect(ids).toContain(9202); // 8800 + 402 from surviving person 402
  });

  it('reuses session-cached credits on a second generation (and does not cache failures)', async () => {
    let movieCreditsCalls = 0;
    let personCreditsCalls = 0;
    let failPersonOnce = true;

    const ratings: UserRating[] = [
      makeRating(11, 9, 100),
      makeRating(12, 9, 200),
      makeRating(13, 9, 300),
    ];

    server.use(
      http.get('https://api.themoviedb.org/3/discover/movie', () =>
        HttpResponse.json({ page: 1, results: [] })
      ),
      http.get('https://api.themoviedb.org/3/trending/movie/:timeWindow', () =>
        HttpResponse.json({ page: 1, results: [] })
      ),
      http.get('https://api.themoviedb.org/3/movie/:id/recommendations', () =>
        HttpResponse.json({ page: 1, results: [] })
      ),
      http.get('https://api.themoviedb.org/3/movie/:id/similar', () =>
        HttpResponse.json({ page: 1, results: [] })
      ),
      http.get('https://api.themoviedb.org/3/movie/:id/credits', ({ params }) => {
        movieCreditsCalls++;
        const id = Number(params.id);
        return HttpResponse.json({
          id,
          crew: [{ id: id === 11 ? 601 : 602, job: 'Director' }],
        });
      }),
      http.get('https://api.themoviedb.org/3/person/:id/movie_credits', ({ params }) => {
        personCreditsCalls++;
        const personId = Number(params.id);
        if (personId === 601 && failPersonOnce) {
          failPersonOnce = false;
          return new HttpResponse(null, { status: 500 });
        }
        return HttpResponse.json({
          id: personId,
          crew: [
            {
              id: 7000 + personId,
              title: `Cached Creator Film ${personId}`,
              poster_path: `/p${personId}.jpg`,
              vote_count: 100,
              vote_average: 7.8,
              genre_ids: [18],
              job: 'Director',
            },
          ],
        });
      })
    );

    const first = await generateCandidates(ratings, { seedCount: 0 });
    expect(movieCreditsCalls).toBe(3);
    expect(personCreditsCalls).toBe(2);
    // Only person 602 succeeded on first run
    expect(first.some((c) => c.movie.id === 7602)).toBe(true);
    expect(first.some((c) => c.movie.id === 7601)).toBe(false);

    // Clear tmdbClient's generic URL cache to prove creator-graph's own session BoundedLRUMap caches work
    clearTmdbCache();

    // Second generation: 0 /movie/*/credits calls, only 1 /person/601/movie_credits retry (602 is cached)
    const second = await generateCandidates(ratings, { seedCount: 0 });
    expect(movieCreditsCalls).toBe(3);
    expect(personCreditsCalls).toBe(3);
    expect(second.some((c) => c.movie.id === 7602)).toBe(true);
    expect(second.some((c) => c.movie.id === 7601)).toBe(true);

    // Third generation: all credits cached -> zero additional requests
    clearTmdbCache();
    const third = await generateCandidates(ratings, { seedCount: 0 });
    expect(movieCreditsCalls).toBe(3);
    expect(personCreditsCalls).toBe(3);
    expect(third.some((c) => c.movie.id === 7601)).toBe(true);
    expect(third.some((c) => c.movie.id === 7602)).toBe(true);
  });

  it('bounds both movie and person credits caches at ~200 entries via LRU eviction', async () => {
    const requestedCredits: number[] = [];
    const requestedPersonCredits: number[] = [];

    server.use(
      http.get('https://api.themoviedb.org/3/discover/movie', () =>
        HttpResponse.json({ page: 1, results: [] })
      ),
      http.get('https://api.themoviedb.org/3/trending/movie/:timeWindow', () =>
        HttpResponse.json({ page: 1, results: [] })
      ),
      http.get('https://api.themoviedb.org/3/movie/:id/credits', ({ params }) => {
        const id = Number(params.id);
        requestedCredits.push(id);
        return HttpResponse.json({ id, crew: [{ id: 10000 + id, job: 'Director' }] });
      }),
      http.get('https://api.themoviedb.org/3/person/:id/movie_credits', ({ params }) => {
        const personId = Number(params.id);
        requestedPersonCredits.push(personId);
        return HttpResponse.json({ id: personId, crew: [] });
      })
    );

    // Populate 210 distinct movies and 210 distinct people across 35 calls (6 movies per call) ->
    // exceeds 200-entry LRU bound so batch 0 (movie 1 / person 10001) is evicted regardless of ordering
    for (let batch = 0; batch < 35; batch++) {
      const base = batch * 6 + 1;
      const batchRatings = Array.from({ length: 6 }, (_, i) =>
        makeRating(base + i, 9, 1000 + i)
      );
      await generateCandidates(batchRatings, { seedCount: 0 });
    }
    expect(requestedCredits).toHaveLength(210);
    expect(requestedPersonCredits).toHaveLength(210);

    // Clear tmdbClient's cache and re-request movie 1 (oldest, evicted) vs movies 204/203 (newest, still cached)
    clearTmdbCache();
    requestedCredits.length = 0;
    requestedPersonCredits.length = 0;

    await generateCandidates(
      [makeRating(1, 9, 1000), makeRating(204, 9, 2000), makeRating(203, 9, 3000)],
      { seedCount: 0 }
    );

    expect(requestedCredits).toContain(1);
    expect(requestedCredits).not.toContain(204);
    expect(requestedCredits).not.toContain(203);
    expect(requestedPersonCredits).toContain(10001);
    expect(requestedPersonCredits).not.toContain(10204);
    expect(requestedPersonCredits).not.toContain(10203);
  });

  it('supports Record<number, UserRating> input and rejects with AbortError on caller abort during creator graph', async () => {
    const ratingsRecord: Record<number, UserRating> = {
      11: makeRating(11, 9, 100),
      12: makeRating(12, 9, 200),
      13: makeRating(13, 9, 300),
    };

    server.use(
      http.get('https://api.themoviedb.org/3/discover/movie', () =>
        HttpResponse.json({ page: 1, results: [] })
      ),
      http.get('https://api.themoviedb.org/3/trending/movie/:timeWindow', () =>
        HttpResponse.json({ page: 1, results: [] })
      ),
      http.get('https://api.themoviedb.org/3/movie/:id/credits', ({ params }) => {
        const id = Number(params.id);
        return HttpResponse.json({
          id,
          crew: [{ id: 500 + id, job: 'Director' }],
        });
      }),
      http.get('https://api.themoviedb.org/3/person/:id/movie_credits', ({ params }) => {
        const personId = Number(params.id);
        return HttpResponse.json({
          id: personId,
          crew: [
            {
              id: 6000 + personId,
              title: `Record Creator Film ${personId}`,
              poster_path: `/rec_${personId}.jpg`,
              vote_count: 100,
              vote_average: 8.0,
              genre_ids: [18],
              job: 'Director',
            },
          ],
        });
      })
    );

    const fromRecord = await generateCandidates(ratingsRecord, { seedCount: 0 });
    expect(fromRecord.some((c) => c.movie.id === 6511 && c.sources.includes('creator_graph'))).toBe(
      true
    );

    clearTmdbCache();
    clearCreatorGraphCache();
    let personRequestsStarted = 0;
    let resolvePersonStarted!: () => void;
    const personStarted = new Promise<void>((resolve) => {
      resolvePersonStarted = resolve;
    });
    const caller = new AbortController();

    server.use(
      http.get('https://api.themoviedb.org/3/person/:id/movie_credits', async () => {
        personRequestsStarted++;
        resolvePersonStarted();
        await delay(60);
        return HttpResponse.json({ id: 1, crew: [] });
      })
    );

    const abortedPromise = generateCandidates(ratingsRecord, { seedCount: 0 }, caller.signal);
    await personStarted;
    caller.abort();
    await expect(abortedPromise).rejects.toMatchObject({ name: 'AbortError' });
    const afterAbort = personRequestsStarted;
    expect(afterAbort).toBeGreaterThan(0);
    await delay(80);
    expect(personRequestsStarted).toBe(afterAbort);
  });
});
