import { describe, it, expect, beforeEach, vi } from 'vitest';
import { http, HttpResponse, delay } from 'msw';
import { server } from '../../../test/mocks/server';
import { credentialStore } from '../../credentialStore';
import { clearTmdbCache } from '../../tmdbClient';
import { enrichCandidates, clearEnrichmentCache } from '../enrichCandidates';
import { getCandidateRecommendationPool } from '../candidateSources';
import { rankCandidates } from '../rankCandidates';
import type { Candidate } from '../types';
import type { Movie, UserRating } from '../../../types';

function makeCandidate(
  id: number,
  overrides: Partial<Movie> = {},
  sources: Candidate['sources'] = ['seed_graph'],
  seedNeighbour = true
): Candidate {
  return {
    movie: {
      id,
      title: `Film_${id}`,
      overview: `Overview ${id}`,
      poster_path: `/p${id}.jpg`,
      backdrop_path: null,
      release_date: '2015-06-01',
      vote_average: 7.8,
      vote_count: 2000,
      genre_ids: [18],
      genres: [{ id: 18, name: 'Drama' }],
      ...overrides,
    },
    sources,
    seedNeighbour,
  };
}

describe('enrichCandidates', () => {
  beforeEach(() => {
    credentialStore.setTmdbCredential('read_access_token', 'mock-token');
    clearTmdbCache();
    clearEnrichmentCache();
    vi.restoreAllMocks();
  });

  it('enriches shortlist candidates with director and keywords while preserving order, count, and metadata', async () => {
    const requestedUrls: string[] = [];

    server.use(
      http.get('https://api.themoviedb.org/3/movie/:id', ({ params, request }) => {
        requestedUrls.push(request.url);
        const id = Number(params.id);
        const rawKeywords = Array.from({ length: 25 }, (_, idx) => ({
          id: idx + 1,
          name: idx === 1 ? 'keyword-0' : `keyword-${idx}`, // includes a duplicate to verify deduplication
        }));
        return HttpResponse.json({
          id,
          credits: {
            crew: [
              { job: 'Producer', name: `Producer ${id}` },
              { job: 'Director', name: `Director ${id}` },
            ],
          },
          keywords: {
            keywords: rawKeywords,
          },
        });
      })
    );

    const pool: Candidate[] = Array.from({ length: 45 }, (_, i) => {
      const id = i + 1;
      if (id === 3) {
        return makeCandidate(id, { director: 'Preexisting Director' }, ['creator_graph'], false);
      }
      return makeCandidate(id);
    });
    const originalFirstDirector = pool[0].movie.director;

    const enriched = await enrichCandidates(pool);

    // Order and count are preserved, input is not mutated
    expect(enriched).toHaveLength(45);
    expect(enriched.map((c) => c.movie.id)).toEqual(pool.map((c) => c.movie.id));
    expect(pool[0].movie.director).toBe(originalFirstDirector);

    // Candidate 3 already had a director so it was skipped
    expect(enriched[2].movie.director).toBe('Preexisting Director');
    expect(requestedUrls.some((u) => u.includes('/movie/3?'))).toBe(false);

    // Candidates inside the 40-item shortlist without a director are enriched
    expect(enriched[0].movie.director).toBe('Director 1');
    expect(enriched[0].movie.keywords).toHaveLength(20);
    expect(enriched[0].movie.keywords?.filter((k) => k === 'keyword-0')).toHaveLength(1);
    expect(enriched[0].movie.keywords).toContain('keyword-20');
    expect(enriched[0].sources).toEqual(['seed_graph']);
    expect(enriched[0].seedNeighbour).toBe(true);
    expect(enriched[39].movie.director).toBe('Director 40');

    // Query includes append_to_response=credits,keywords
    expect(requestedUrls[0]).toContain('append_to_response=credits%2Ckeywords');

    // Candidates outside the 40-item shortlist stay genre-only
    for (let i = 40; i < 45; i++) {
      expect(enriched[i].movie.director).toBeUndefined();
      expect(enriched[i].movie.keywords).toBeUndefined();
      expect(requestedUrls.some((u) => u.includes(`/movie/${i + 1}?`))).toBe(false);
    }
  });

  it('enforces at most limit requests and at most 6 in flight, and hits the session cache on repeat calls', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let totalRequests = 0;

    server.use(
      http.get('https://api.themoviedb.org/3/movie/:id', async ({ params }) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        totalRequests++;
        await delay(10);
        inFlight--;

        const id = Number(params.id);
        return HttpResponse.json({
          id,
          credits: { crew: [{ job: 'Director', name: `Director ${id}` }] },
          keywords: { keywords: [{ id: 1, name: `theme-${id}` }] },
        });
      })
    );

    const pool1 = Array.from({ length: 50 }, (_, i) => makeCandidate(100 + i));
    const first = await enrichCandidates(pool1);

    expect(totalRequests).toBe(40);
    expect(maxInFlight).toBeLessThanOrEqual(6);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(first[0].movie.director).toBe('Director 100');
    expect(first[40].movie.director).toBeUndefined();

    // Clear tmdbClient cache to verify enrichCandidates' own session cache serves the hit
    clearTmdbCache();
    const pool2 = Array.from({ length: 50 }, (_, i) => makeCandidate(100 + i));
    const second = await enrichCandidates(pool2);

    expect(totalRequests).toBe(40);
    expect(second[0].movie.director).toBe('Director 100');
    expect(second[0].movie.keywords).toEqual(['theme-100']);
    expect(second[39].movie.director).toBe('Director 139');
  });

  it('bounds the session cache to 300 entries using LRU eviction', async () => {
    const fetchedIds: number[] = [];

    server.use(
      http.get('https://api.themoviedb.org/3/movie/:id', ({ params }) => {
        const id = Number(params.id);
        fetchedIds.push(id);
        return HttpResponse.json({
          id,
          credits: { crew: [{ job: 'Director', name: `Director ${id}` }] },
          keywords: { keywords: [{ id: 1, name: `kw-${id}` }] },
        });
      })
    );

    // Populate 300 entries (IDs 1..300)
    for (let offset = 0; offset < 300; offset += 40) {
      const batchSize = Math.min(40, 300 - offset);
      const batch = Array.from({ length: batchSize }, (_, i) => makeCandidate(offset + i + 1));
      await enrichCandidates(batch, { limit: 40, concurrency: 10 });
    }
    expect(fetchedIds).toHaveLength(300);

    // Insert 301st entry, which evicts ID 1 (the least recently used)
    await enrichCandidates([makeCandidate(301)]);
    expect(fetchedIds).toHaveLength(301);

    clearTmdbCache();
    fetchedIds.length = 0;

    // ID 300 is still cached (0 requests); ID 1 was evicted and must be refetched (1 request)
    const recentRes = await enrichCandidates([makeCandidate(300)]);
    expect(fetchedIds).toEqual([]);
    expect(recentRes[0].movie.director).toBe('Director 300');

    const evictedRes = await enrichCandidates([makeCandidate(1)]);
    expect(fetchedIds).toEqual([1]);
    expect(evictedRes[0].movie.director).toBe('Director 1');
  });

  it('leaves failed requests unenriched without caching failures', async () => {
    let failMovie102 = true;
    const requestedIds: number[] = [];

    server.use(
      http.get('https://api.themoviedb.org/3/movie/:id', ({ params }) => {
        const id = Number(params.id);
        requestedIds.push(id);
        if (id === 102 && failMovie102) {
          return new HttpResponse(null, { status: 500, statusText: 'Server Error' });
        }
        return HttpResponse.json({
          id,
          credits: { crew: [{ job: 'Director', name: `Director ${id}` }] },
          keywords: { keywords: [{ id: 1, name: `kw-${id}` }] },
        });
      })
    );

    const pool = [101, 102, 103, 104].map((id) => makeCandidate(id));
    const first = await enrichCandidates(pool);

    expect(first.map((c) => c.movie.id)).toEqual([101, 102, 103, 104]);
    expect(first[0].movie.director).toBe('Director 101');
    expect(first[1].movie.director).toBeUndefined();
    expect(first[1].movie.keywords).toBeUndefined();
    expect(first[2].movie.director).toBe('Director 103');
    expect(first[3].movie.director).toBe('Director 104');

    // Recover movie 102: only 102 should be refetched since failures are not cached
    failMovie102 = false;
    clearTmdbCache();
    requestedIds.length = 0;

    const retryPool = [101, 102, 103, 104].map((id) => makeCandidate(id));
    const retried = await enrichCandidates(retryPool);

    expect(requestedIds).toEqual([102]);
    expect(retried[1].movie.director).toBe('Director 102');
    expect(retried[1].movie.keywords).toEqual(['kw-102']);
  });

  it('returns the full list unenriched when signal is already aborted', async () => {
    let requestsStarted = 0;
    server.use(
      http.get('https://api.themoviedb.org/3/movie/:id', () => {
        requestsStarted++;
        return HttpResponse.json({ id: 1, credits: { crew: [] }, keywords: { keywords: [] } });
      })
    );

    const controller = new AbortController();
    controller.abort();

    const pool = [1, 2, 3].map((id) => makeCandidate(id));
    const result = await enrichCandidates(pool, {}, controller.signal);

    expect(requestsStarted).toBe(0);
    expect(result.map((c) => c.movie.id)).toEqual([1, 2, 3]);
    expect(result.every((c) => c.movie.director === undefined)).toBe(true);
  });

  it('aborts mid-flight on caller signal and returns what is enriched so far', async () => {
    const controller = new AbortController();
    let started = 0;
    let fastFinished = 0;

    server.use(
      http.get('https://api.themoviedb.org/3/movie/:id', async ({ params }) => {
        started++;
        const id = Number(params.id);
        if (id <= 2) {
          fastFinished++;
          return HttpResponse.json({
            id,
            credits: { crew: [{ job: 'Director', name: `Director ${id}` }] },
            keywords: { keywords: [{ id: 1, name: `kw-${id}` }] },
          });
        }
        await delay(400);
        return HttpResponse.json({
          id,
          credits: { crew: [{ job: 'Director', name: `Director ${id}` }] },
          keywords: { keywords: [] },
        });
      })
    );

    const pool = [1, 2, 3, 4, 5, 6].map((id) => makeCandidate(id));
    const promise = enrichCandidates(pool, { concurrency: 2, deadlineMs: 5000 }, controller.signal);

    await vi.waitFor(
      () => {
        expect(fastFinished).toBe(2);
        // Reaching started === 4 with concurrency 2 means workers finished applying 1 & 2 and entered 3 & 4
        expect(started).toBe(4);
      },
      { interval: 5 }
    );
    controller.abort();

    const result = await promise;
    expect(result.map((c) => c.movie.id)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result[0].movie.director).toBe('Director 1');
    expect(result[1].movie.director).toBe('Director 2');
    expect(result[4].movie.director).toBeUndefined();
    expect(result[5].movie.director).toBeUndefined();
    expect(started).toBeLessThan(6);
  });

  it('aborts on deadlineMs expiry and handles deadlineMs <= 0', async () => {
    let started = 0;
    server.use(
      http.get('https://api.themoviedb.org/3/movie/:id', async ({ params }) => {
        started++;
        const id = Number(params.id);
        if (id === 1) {
          return HttpResponse.json({
            id,
            credits: { crew: [{ job: 'Director', name: 'Fast Director' }] },
            keywords: { keywords: [{ id: 1, name: 'fast' }] },
          });
        }
        await delay(400);
        return HttpResponse.json({
          id,
          credits: { crew: [{ job: 'Director', name: 'Slow Director' }] },
          keywords: { keywords: [] },
        });
      })
    );

    const pool = [1, 2, 3].map((id) => makeCandidate(id));

    const zeroDeadline = await enrichCandidates(pool, { deadlineMs: 0 });
    expect(started).toBe(0);
    expect(zeroDeadline).toHaveLength(3);
    expect(zeroDeadline[0].movie.director).toBeUndefined();

    const partial = await enrichCandidates(pool, { concurrency: 1, deadlineMs: 60 });
    expect(partial.map((c) => c.movie.id)).toEqual([1, 2, 3]);
    expect(partial[0].movie.director).toBe('Fast Director');
    expect(partial[2].movie.director).toBeUndefined();
  });

  it('increases rankCandidates score for a loved director film after enrichment', async () => {
    server.use(
      http.get('https://api.themoviedb.org/3/movie/:id', ({ params }) => {
        const id = Number(params.id);
        if (id === 201) {
          return HttpResponse.json({
            id,
            credits: { crew: [{ job: 'Director', name: 'Director A' }] },
            keywords: { keywords: [{ id: 1, name: 'character study' }] },
          });
        }
        return HttpResponse.json({
          id,
          credits: { crew: [{ job: 'Director', name: 'Director B' }] },
          keywords: { keywords: [{ id: 2, name: 'action' }] },
        });
      })
    );

    const userRatings: UserRating[] = [
      {
        movieId: 901,
        title: 'Loved A1',
        rating: 10,
        posterPath: null,
        year: '2014',
        genres: ['Drama'],
        director: 'Director A',
        ratedAt: 1000,
      },
      {
        movieId: 902,
        title: 'Loved A2',
        rating: 9,
        posterPath: null,
        year: '2016',
        genres: ['Drama'],
        director: 'Director A',
        ratedAt: 2000,
      },
    ];

    const rawPool: Candidate[] = [
      makeCandidate(201, { vote_average: 7.5 }),
      makeCandidate(202, { vote_average: 7.5 }),
    ];

    const beforeRecs = rankCandidates(rawPool, userRatings, { serendipityLevel: 30 });
    const scoreBefore = beforeRecs.find((r) => r.movie.id === 201)!.score;

    const enrichedPool = await enrichCandidates(rawPool);
    const afterRecs = rankCandidates(enrichedPool, userRatings, { serendipityLevel: 30 });
    const scoreAfter = afterRecs.find((r) => r.movie.id === 201)!.score;
    const otherScoreAfter = afterRecs.find((r) => r.movie.id === 202)!.score;

    expect(scoreAfter).toBeGreaterThan(scoreBefore);
    expect(scoreAfter).toBeGreaterThan(otherScoreAfter);
  });

  it('causes MMR in rankCandidates to separate same-director films with identical genres', async () => {
    const directorById: Record<number, string> = {
      1: 'Director A',
      2: 'Director A',
      3: 'Director B',
      4: 'Director C',
      5: 'Director D',
      6: 'Director E',
      7: 'Director F',
      8: 'Director G',
    };

    server.use(
      http.get('https://api.themoviedb.org/3/movie/:id', ({ params }) => {
        const id = Number(params.id);
        return HttpResponse.json({
          id,
          credits: { crew: [{ job: 'Director', name: directorById[id] ?? `Director ${id}` }] },
          keywords: { keywords: [] },
        });
      })
    );

    const userRatings: UserRating[] = [
      {
        movieId: 1001,
        title: 'Loved A',
        rating: 10,
        posterPath: null,
        year: '2014',
        genres: ['Drama'],
        director: 'Director A',
        ratedAt: 1000,
      },
      {
        movieId: 1002,
        title: 'Liked B',
        rating: 9,
        posterPath: null,
        year: '2015',
        genres: ['Drama'],
        director: 'Director B',
        ratedAt: 2000,
      },
      {
        movieId: 1003,
        title: 'Liked C',
        rating: 9,
        posterPath: null,
        year: '2016',
        genres: ['Drama'],
        director: 'Director C',
        ratedAt: 3000,
      },
    ];

    const rawPool: Candidate[] = [
      // 4 safe_bet candidates with identical Drama genre
      makeCandidate(1, { vote_average: 8.4, vote_count: 2000, release_date: '2015-06-01' }, ['seed_graph'], true),
      makeCandidate(2, { vote_average: 8.3, vote_count: 2000, release_date: '2015-06-01' }, ['seed_graph'], true),
      makeCandidate(3, { vote_average: 8.2, vote_count: 2000, release_date: '2015-06-01' }, ['seed_graph'], true),
      makeCandidate(4, { vote_average: 8.1, vote_count: 2000, release_date: '2015-06-01' }, ['seed_graph'], true),
      // 2 stretch and 2 wildcard candidates
      makeCandidate(
        5,
        { genres: [{ id: 18, name: 'Drama' }, { id: 9648, name: 'Mystery' }], vote_average: 7.9, vote_count: 800, release_date: '2015-06-01' },
        ['hidden_gem'],
        false
      ),
      makeCandidate(
        6,
        { genres: [{ id: 18, name: 'Drama' }, { id: 9648, name: 'Mystery' }], vote_average: 7.8, vote_count: 750, release_date: '2015-06-01' },
        ['hidden_gem'],
        false
      ),
      makeCandidate(
        7,
        { genres: [{ id: 18, name: 'Drama' }, { id: 37, name: 'Western' }], vote_average: 7.8, vote_count: 400, release_date: '1975-06-01' },
        ['hidden_gem'],
        false
      ),
      makeCandidate(
        8,
        { genres: [{ id: 18, name: 'Drama' }, { id: 37, name: 'Western' }], vote_average: 7.7, vote_count: 350, release_date: '1976-06-01' },
        ['hidden_gem'],
        false
      ),
    ];

    // Before enrichment, films 1 and 2 have no director metadata so MMR puts them back-to-back
    const beforeRecs = rankCandidates(rawPool, userRatings, { serendipityLevel: 30 });
    const beforeIdx1 = beforeRecs.findIndex((r) => r.movie.id === 1);
    const beforeIdx2 = beforeRecs.findIndex((r) => r.movie.id === 2);
    expect(Math.abs(beforeIdx1 - beforeIdx2)).toBe(1);

    // After enrichment, MMR separates the two Director A films
    const enrichedPool = await enrichCandidates(rawPool);
    const afterRecs = rankCandidates(enrichedPool, userRatings, { serendipityLevel: 30 });
    const afterIdx1 = afterRecs.findIndex((r) => r.movie.id === 1);
    const afterIdx2 = afterRecs.findIndex((r) => r.movie.id === 2);

    expect(afterIdx1).toBeGreaterThanOrEqual(0);
    expect(afterIdx2).toBeGreaterThanOrEqual(0);
    expect(Math.abs(afterIdx1 - afterIdx2)).toBeGreaterThan(1);
  });

  it('getCandidateRecommendationPool enriches shortlist candidates while preserving source annotations', async () => {
    server.use(
      http.get('https://api.themoviedb.org/3/movie/:id/recommendations', () =>
        HttpResponse.json({
          page: 1,
          results: [
            {
              id: 501,
              title: 'Seed Neighbour Film',
              poster_path: '/501.jpg',
              release_date: '2021-01-01',
              vote_average: 8.1,
              vote_count: 900,
              genre_ids: [18],
            },
          ],
        })
      ),
      http.get('https://api.themoviedb.org/3/movie/:id/similar', () =>
        HttpResponse.json({ page: 1, results: [] })
      ),
      http.get('https://api.themoviedb.org/3/discover/movie', () =>
        HttpResponse.json({ page: 1, results: [] })
      ),
      http.get('https://api.themoviedb.org/3/trending/movie/:timeWindow', () =>
        HttpResponse.json({ page: 1, results: [] })
      ),
      http.get('https://api.themoviedb.org/3/movie/:id', ({ params }) =>
        HttpResponse.json({
          id: Number(params.id),
          credits: { crew: [{ job: 'Director', name: 'Auteur Director' }] },
          keywords: { keywords: [{ id: 10, name: 'atmospheric' }] },
        })
      )
    );

    const pool = await getCandidateRecommendationPool({
      userRatings: [
        {
          movieId: 10,
          title: 'Seed 10',
          rating: 9,
          posterPath: '/10.jpg',
          genres: ['Drama'],
          ratedAt: 1000,
        },
      ],
      seedCount: 1,
    });

    expect(pool).toHaveLength(1);
    expect(pool[0].id).toBe(501);
    expect(pool[0].director).toBe('Auteur Director');
    expect(pool[0].keywords).toEqual(['atmospheric']);
    expect(pool[0].candidateSources).toEqual(['seed_graph']);
    expect(pool[0].seedNeighbour).toBe(true);
  });

  it('honors custom limit and concurrency options and handles limit <= 0', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const requestedIds: number[] = [];

    server.use(
      http.get('https://api.themoviedb.org/3/movie/:id', async ({ params }) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const id = Number(params.id);
        requestedIds.push(id);
        await delay(10);
        inFlight--;
        return HttpResponse.json({
          id,
          credits: { crew: [{ job: 'Director', name: `Director ${id}` }] },
          keywords: { keywords: [{ id: 1, name: `kw-${id}` }] },
        });
      })
    );

    const pool = [1, 2, 3, 4, 5, 6].map((id) => makeCandidate(id));

    expect(await enrichCandidates(pool, { limit: 0 })).toHaveLength(6);
    expect(await enrichCandidates(pool, { limit: -3 })).toHaveLength(6);
    expect(requestedIds).toHaveLength(0);

    const limited = await enrichCandidates(pool, { limit: 3, concurrency: 2 });
    expect(requestedIds).toEqual([1, 2, 3]);
    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(maxInFlight).toBe(2);
    expect(limited[0].movie.director).toBe('Director 1');
    expect(limited[2].movie.director).toBe('Director 3');
    expect(limited[3].movie.director).toBeUndefined();
    expect(limited[5].movie.director).toBeUndefined();
  });

  it('handles empty, single-item, duplicate IDs, invalid IDs, and NaN/Infinity/large options', async () => {
    const requestedIds: number[] = [];
    server.use(
      http.get('https://api.themoviedb.org/3/movie/:id', ({ params }) => {
        const id = Number(params.id);
        requestedIds.push(id);
        return HttpResponse.json({
          id,
          credits: { crew: [{ job: 'Director', name: `Director ${id}` }] },
          keywords: { keywords: [{ id: 1, name: `kw-${id}` }] },
        });
      })
    );

    expect(await enrichCandidates([])).toEqual([]);
    expect(requestedIds).toHaveLength(0);

    const single = await enrichCandidates([makeCandidate(77)], {
      limit: Number.NaN,
      concurrency: Number.NaN,
      deadlineMs: Number.NaN,
    });
    expect(single).toHaveLength(1);
    expect(single[0].movie.director).toBe('Director 77');
    expect(requestedIds).toEqual([77]);

    clearTmdbCache();
    clearEnrichmentCache();
    requestedIds.length = 0;

    // Duplicate IDs coalesce into 1 fetch; invalid IDs (NaN, 0, -5) are skipped safely
    const edgePool: Candidate[] = [
      makeCandidate(Number.NaN),
      makeCandidate(0),
      makeCandidate(-5),
      makeCandidate(88),
      makeCandidate(88),
    ];
    const edgeResult = await enrichCandidates(edgePool, {
      limit: Number.POSITIVE_INFINITY,
      concurrency: 0,
      deadlineMs: 1e12,
    });
    expect(requestedIds).toEqual([88]);
    expect(edgeResult).toHaveLength(5);
    expect(edgeResult[0].movie.director).toBeUndefined();
    expect(edgeResult[1].movie.director).toBeUndefined();
    expect(edgeResult[2].movie.director).toBeUndefined();
    expect(edgeResult[3].movie.director).toBe('Director 88');
    expect(edgeResult[4].movie.director).toBe('Director 88');
  });
});
