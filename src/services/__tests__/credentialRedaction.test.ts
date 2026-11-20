import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { credentialStore } from '../credentialStore';
import {
  clearTmdbCache,
  fetchFromTMDB,
  getMovieDetails,
  hydrateMovieByTitleAndYear,
  redactTmdbUrl,
  testTmdbConnection,
} from '../tmdb';
import { aiManager } from '../ai/aiManager';
import type { Movie, UserRating } from '../../types';

const TMDB_V3_KEY = 'tmdb_v3_secret_987654321';
const AI_API_KEY = 'sk-ai-secret-123456789';

function serializeConsoleArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}\n${arg.stack ?? ''}`;
  }
  try {
    return JSON.stringify(arg) ?? String(arg);
  } catch {
    return String(arg);
  }
}

function assertNoSecretInConsoleSpies(
  secrets: string[],
  warnSpy: ReturnType<typeof vi.spyOn>,
  errorSpy: ReturnType<typeof vi.spyOn>
): void {
  const allCalls = [...warnSpy.mock.calls, ...errorSpy.mock.calls];
  for (const args of allCalls) {
    const serialized = args.map(serializeConsoleArg).join(' ');
    for (const secret of secrets) {
      expect(serialized).not.toContain(secret);
    }
  }
}

describe('Credential redaction guard (CIN-53)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    credentialStore.forgetAll();
    clearTmdbCache();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    credentialStore.forgetAll();
    clearTmdbCache();
  });

  it('redactTmdbUrl strips api_key from full URLs and embedded error strings', () => {
    const url = `https://api.themoviedb.org/3/movie/550?language=en-US&api_key=${TMDB_V3_KEY}`;
    expect(redactTmdbUrl(url)).not.toContain(TMDB_V3_KEY);
    expect(redactTmdbUrl(url)).toContain('api_key=%5BREDACTED%5D');

    const embedded = `Request failed for https://api.themoviedb.org/3/search/movie?api_key=${TMDB_V3_KEY}&query=Heat`;
    expect(redactTmdbUrl(embedded)).not.toContain(TMDB_V3_KEY);
    expect(redactTmdbUrl(embedded)).toContain('api_key=[REDACTED]');
  });

  describe('TMDB v3 API key mode', () => {
    beforeEach(() => {
      credentialStore.setTmdbCredential('api_key', TMDB_V3_KEY);
    });

    it('never leaks the v3 api_key on MSW 500 response', async () => {
      let capturedUrl = '';
      server.use(
        http.get('https://api.themoviedb.org/3/movie/:id', ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.json(
            { status_message: 'Internal error' },
            { status: 500, statusText: 'Internal Server Error' }
          );
        })
      );

      let caught: unknown;
      try {
        await getMovieDetails(550);
      } catch (err) {
        caught = err;
      }

      expect(capturedUrl).toContain(`api_key=${TMDB_V3_KEY}`);
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).not.toContain(TMDB_V3_KEY);
      expect((caught as Error).message).not.toContain('api_key=');
      assertNoSecretInConsoleSpies([TMDB_V3_KEY], warnSpy, errorSpy);
    });

    it('never leaks the v3 api_key on MSW network error', async () => {
      let capturedUrl = '';
      server.use(
        http.get('https://api.themoviedb.org/3/movie/:id', ({ request }) => {
          capturedUrl = request.url;
          return HttpResponse.error();
        })
      );

      let caught: unknown;
      try {
        await fetchFromTMDB('/movie/551');
      } catch (err) {
        caught = err;
      }

      expect(capturedUrl).toContain(`api_key=${TMDB_V3_KEY}`);
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).not.toContain(TMDB_V3_KEY);
      assertNoSecretInConsoleSpies([TMDB_V3_KEY], warnSpy, errorSpy);
    });

    it('never logs the raw error object or api_key from hydrateMovieByTitleAndYear on 500 or network error', async () => {
      server.use(
        http.get('https://api.themoviedb.org/3/search/movie', () => {
          return HttpResponse.json(
            { status_message: 'Upstream error' },
            { status: 500, statusText: 'Internal Server Error' }
          );
        })
      );

      const res500 = await hydrateMovieByTitleAndYear('Heat', '1995');
      expect(res500).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
      assertNoSecretInConsoleSpies([TMDB_V3_KEY], warnSpy, errorSpy);

      warnSpy.mockClear();
      server.use(
        http.get('https://api.themoviedb.org/3/search/movie', () => {
          return HttpResponse.error();
        })
      );

      const resNet = await hydrateMovieByTitleAndYear('Collateral', '2004');
      expect(resNet).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
      assertNoSecretInConsoleSpies([TMDB_V3_KEY], warnSpy, errorSpy);
    });

    it('redacts api_key even when fetch rejects with a URL-bearing error message', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockRejectedValue(
            new TypeError(
              `request to https://api.themoviedb.org/3/search/movie?language=en-US&query=Thief&api_key=${TMDB_V3_KEY} failed`
            )
          )
      );

      let caught: unknown;
      try {
        await fetchFromTMDB('/search/movie', { query: 'Thief' });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).not.toContain(TMDB_V3_KEY);
      expect((caught as Error).message).toContain('[REDACTED]');

      const hydrated = await hydrateMovieByTitleAndYear('Thief', '1981');
      expect(hydrated).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
      assertNoSecretInConsoleSpies([TMDB_V3_KEY], warnSpy, errorSpy);

      const conn = await testTmdbConnection('api_key', TMDB_V3_KEY);
      expect(conn.success).toBe(false);
      expect(conn.message).not.toContain(TMDB_V3_KEY);
      expect(conn.message).toContain('[REDACTED]');
    });
  });

  describe('AI provider errors through aiManager', () => {
    const candidatePool: Movie[] = [
      {
        id: 101,
        title: 'Candidate Film A',
        overview: 'Overview A',
        release_date: '2022-01-01',
        vote_average: 8.0,
        vote_count: 500,
        poster_path: '/a.jpg',
        backdrop_path: null,
        genres: [{ id: 878, name: 'Sci-Fi' }],
      },
    ];

    const userRatings: UserRating[] = [
      {
        movieId: 1,
        title: 'Rated Film',
        rating: 9,
        posterPath: '/r.jpg',
        genres: ['Sci-Fi'],
        ratedAt: 1700000000000,
      },
    ];

    it('never leaks AI key in console spies or fallback error on MSW 500 response', async () => {
      server.use(
        http.post('https://generativelanguage.googleapis.com/v1beta/models/:model', () => {
          return HttpResponse.json(
            { error: { message: `API key not valid: ${AI_API_KEY}` } },
            { status: 500 }
          );
        })
      );

      const res = await aiManager.generateRecommendations('gemini', {
        userRatings,
        candidatePool,
        serendipityLevel: 30,
        apiKey: AI_API_KEY,
      });

      expect(res.usedProvider).toContain('Local Engine (Fallback');
      expect(res.usedProvider).not.toContain(AI_API_KEY);
      expect(res.error).toBeDefined();
      expect(res.error).not.toContain(AI_API_KEY);
      expect(warnSpy).toHaveBeenCalled();
      assertNoSecretInConsoleSpies([AI_API_KEY], warnSpy, errorSpy);
    });

    it('never leaks AI key in console spies or fallback error on MSW network error', async () => {
      server.use(
        http.post('https://openrouter.ai/api/v1/chat/completions', () => {
          return HttpResponse.error();
        })
      );

      const res = await aiManager.generateRecommendations('openrouter', {
        userRatings,
        candidatePool,
        serendipityLevel: 30,
        apiKey: AI_API_KEY,
      });

      expect(res.usedProvider).toContain('Local Engine (Fallback');
      expect(res.usedProvider).not.toContain(AI_API_KEY);
      expect(res.error).toBeDefined();
      expect(res.error).not.toContain(AI_API_KEY);
      expect(warnSpy).toHaveBeenCalled();
      assertNoSecretInConsoleSpies([AI_API_KEY], warnSpy, errorSpy);
    });

    it('never leaks Groq AI key in console spies or fallback error on MSW 500 or network error', async () => {
      server.use(
        http.post('https://api.groq.com/openai/v1/chat/completions', () => {
          return HttpResponse.json(
            { error: { message: `Invalid key ${AI_API_KEY} in organization org_secret123` } },
            { status: 500 }
          );
        })
      );

      const res500 = await aiManager.generateRecommendations('groq', {
        userRatings,
        candidatePool,
        serendipityLevel: 30,
        apiKey: AI_API_KEY,
      });

      expect(res500.usedProvider).toContain('Local Engine (Fallback');
      expect(res500.usedProvider).not.toContain(AI_API_KEY);
      expect(res500.usedProvider).not.toContain('org_secret123');
      expect(res500.error).toBeDefined();
      expect(res500.error).not.toContain(AI_API_KEY);
      expect(res500.error).not.toContain('org_secret123');
      expect(warnSpy).toHaveBeenCalled();
      assertNoSecretInConsoleSpies([AI_API_KEY, 'org_secret123'], warnSpy, errorSpy);

      warnSpy.mockClear();
      server.use(
        http.post('https://api.groq.com/openai/v1/chat/completions', () => {
          return HttpResponse.error();
        })
      );

      const resNet = await aiManager.generateRecommendations('groq', {
        userRatings,
        candidatePool,
        serendipityLevel: 30,
        apiKey: AI_API_KEY,
      });

      expect(resNet.usedProvider).toContain('Local Engine (Fallback');
      expect(resNet.usedProvider).not.toContain(AI_API_KEY);
      expect(resNet.error).toBeDefined();
      expect(resNet.error).not.toContain(AI_API_KEY);
      expect(warnSpy).toHaveBeenCalled();
      assertNoSecretInConsoleSpies([AI_API_KEY], warnSpy, errorSpy);
    });

    it('redacts raw error messages containing AI key or TMDB url during provider and backfill failures', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(
          new Error(
            `Upstream failure for key ${AI_API_KEY} at https://api.themoviedb.org/3/movie/1?api_key=${TMDB_V3_KEY}`
          )
        )
      );

      const providerFailRes = await aiManager.generateRecommendations('gemini', {
        userRatings,
        candidatePool,
        serendipityLevel: 30,
        apiKey: AI_API_KEY,
      });

      expect(providerFailRes.usedProvider).not.toContain(AI_API_KEY);
      expect(providerFailRes.usedProvider).not.toContain(TMDB_V3_KEY);
      expect(providerFailRes.error).not.toContain(AI_API_KEY);
      expect(providerFailRes.error).not.toContain(TMDB_V3_KEY);
      expect(warnSpy).toHaveBeenCalled();
      assertNoSecretInConsoleSpies([AI_API_KEY, TMDB_V3_KEY], warnSpy, errorSpy);

      warnSpy.mockClear();

      // Also exercise the local backfill warning branch inside aiManager
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    taste_analysis: 'Short list.',
                    pool_rankings: [
                      {
                        id: 101,
                        score: 90,
                        reason: 'Top match',
                        serendipityType: 'safe_bet',
                        highlightTags: ['Sci-Fi'],
                      },
                    ],
                    unconstrained_discoveries: [],
                  }),
                },
              },
            ],
          }),
        })
      );

      const extraPool: Movie[] = [
        ...candidatePool,
        {
          id: 102,
          title: 'Extra Film',
          overview: 'Overview B',
          release_date: '2021-01-01',
          vote_average: 7.5,
          vote_count: 300,
          poster_path: '/b.jpg',
          backdrop_path: null,
          genres: [{ id: 878, name: 'Sci-Fi' }],
        },
      ];

      const localProvider = aiManager.getProvider('local');
      vi.spyOn(localProvider, 'generateRecommendations').mockRejectedValueOnce(
        new Error(`Backfill crashed with key ${AI_API_KEY}`)
      );

      const backfillFailRes = await aiManager.generateRecommendations('openrouter', {
        userRatings,
        candidatePool: extraPool,
        serendipityLevel: 30,
        apiKey: AI_API_KEY,
      });

      expect(backfillFailRes.recommendations).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalled();
      assertNoSecretInConsoleSpies([AI_API_KEY], warnSpy, errorSpy);
    });
  });
});
