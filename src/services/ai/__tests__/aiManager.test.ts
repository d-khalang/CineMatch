import { describe, it, expect, vi, afterEach } from 'vitest';
import { aiManager, MIN_RECOMMENDATIONS } from '../aiManager';
import { Movie, UserRating } from '../../../types';

describe('aiManager Orchestrator and Fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const candidatePool: Movie[] = [
    {
      id: 101,
      title: 'Candidate Film A',
      overview: 'Overview A',
      release_date: '2022-01-01',
      vote_average: 8.0,
      vote_count: 500,
      poster_path: null,
      backdrop_path: null,
      genres: [{ id: 878, name: 'Sci-Fi' }],
    },
  ];

  const userRatings: UserRating[] = [
    {
      movieId: 1,
      title: 'Rated Film',
      rating: 9,
      posterPath: null,
      genres: ['Sci-Fi'],
      ratedAt: Date.now(),
    },
  ];

  it('falls back to Local Smart Engine if Gemini provider is selected without API key', async () => {
    const res = await aiManager.generateRecommendations('gemini', {
      userRatings,
      candidatePool,
      serendipityLevel: 30,
      apiKey: '', // Empty key
    });

    expect(res.usedProvider).toContain('Local Smart Engine');
    expect(res.recommendations.length).toBeGreaterThan(0);
  });

  it('falls back to Local Smart Engine if OpenRouter provider is selected without API key', async () => {
    const res = await aiManager.generateRecommendations('openrouter', {
      userRatings,
      candidatePool,
      serendipityLevel: 30,
      apiKey: '', // Empty key
    });

    expect(res.usedProvider).toContain('Local Smart Engine');
    expect(res.recommendations.length).toBeGreaterThan(0);
  });

  it('propagates cancellation AbortError without triggering fallback or masquerading as error', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      aiManager.generateRecommendations(
        'gemini',
        {
          userRatings,
          candidatePool,
          serendipityLevel: 30,
          apiKey: 'some-test-key',
        },
        controller.signal
      )
    ).rejects.toThrow();
  });

  it('falls back to Local Smart Engine with error details when OpenRouter encounters a wrong custom model error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ error: { message: "Model 'invalid/bad-model' does not exist" } }),
    }));

    const res = await aiManager.generateRecommendations('openrouter', {
      userRatings,
      candidatePool,
      serendipityLevel: 30,
      apiKey: 'sk-or-test-key',
      model: 'invalid/bad-model',
    });

    expect(res.usedProvider).toContain('Local Engine (Fallback');
    expect(res.error).toContain("Model 'invalid/bad-model' does not exist");
    expect(res.recommendations.length).toBeGreaterThan(0);
  });

  it('does not count unconstrained discoveries toward the MIN_RECOMMENDATIONS pool floor', async () => {
    const fullPool: Movie[] = Array.from({ length: 12 }, (_, i) => ({
      id: 200 + i,
      title: `Pool Film ${i}`,
      overview: 'Overview',
      release_date: '2015-01-01',
      vote_average: 7.8,
      vote_count: 900,
      poster_path: `/p${i}.jpg`,
      backdrop_path: null,
      genres: [{ id: 878, name: 'Sci-Fi' }],
    }));

    const content = JSON.stringify({
      taste_analysis: 'Loves thoughtful Sci-Fi.',
      pool_rankings: [
        { id: 200, score: 92, reason: 'AI pick 1', serendipityType: 'safe_bet', highlightTags: ['Sci-Fi'] },
        { id: 201, score: 85, reason: 'AI pick 2', serendipityType: 'safe_bet', highlightTags: ['Sci-Fi'] },
      ],
      unconstrained_discoveries: Array.from({ length: 7 }, (_, i) => ({
        title: `Discovery ${i}`,
        year: '2014',
        score: 90,
        reason: 'External discovery',
        highlightTags: ['Discovery'],
      })),
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content } }] }),
      })
    );

    const res = await aiManager.generateRecommendations('openrouter', {
      userRatings,
      candidatePool: fullPool,
      serendipityLevel: 50,
      apiKey: 'sk-or-test-key',
    });

    expect(res.recommendations.length).toBe(MIN_RECOMMENDATIONS);
    expect(res.unconstrainedDiscoveries).toHaveLength(7);
    expect(res.recommendations.slice(0, 2).map((r) => r.movie.id)).toEqual([200, 201]);
    expect(res.recommendations.slice(2).every((r) => r.isAiCurated === undefined && r.score < 85)).toBe(true);
  });

  it('handles empty AI pool_rankings, empty candidatePool, and single-item candidatePool gracefully', async () => {
    const tenPool: Movie[] = Array.from({ length: 10 }, (_, i) => ({
      id: 300 + i,
      title: `Film ${i}`,
      overview: 'Overview',
      release_date: '2018-01-01',
      vote_average: 7.5,
      vote_count: 600,
      poster_path: `/p${i}.jpg`,
      backdrop_path: null,
      genres: [{ id: 878, name: 'Sci-Fi' }],
    }));

    const emptyRankingsContent = JSON.stringify({
      taste_analysis: 'Minimal AI response.',
      pool_rankings: [],
      unconstrained_discoveries: [],
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: emptyRankingsContent } }] }),
      })
    );

    // 1. Empty AI pool_rankings -> backfilled to MIN_RECOMMENDATIONS (8)
    const zeroAiRes = await aiManager.generateRecommendations('openrouter', {
      userRatings,
      candidatePool: tenPool,
      serendipityLevel: 40,
      apiKey: 'sk-or-test-key',
    });
    expect(zeroAiRes.recommendations).toHaveLength(MIN_RECOMMENDATIONS);
    expect(zeroAiRes.recommendations.every((r) => r.isAiCurated === undefined)).toBe(true);
    expect(zeroAiRes.recommendations.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(zeroAiRes.usedProvider).not.toContain('Fallback');

    // 2. Empty candidatePool -> returns [] without error
    const emptyPoolRes = await aiManager.generateRecommendations('openrouter', {
      userRatings,
      candidatePool: [],
      serendipityLevel: 40,
      apiKey: 'sk-or-test-key',
    });
    expect(emptyPoolRes.recommendations).toEqual([]);
    expect(emptyPoolRes.error).toBeUndefined();

    // 3. Single-item candidatePool -> returns the single film once with rank 1
    const singlePoolRes = await aiManager.generateRecommendations('openrouter', {
      userRatings,
      candidatePool: [tenPool[0]],
      serendipityLevel: 40,
      apiKey: 'sk-or-test-key',
    });
    expect(singlePoolRes.recommendations).toHaveLength(1);
    expect(singlePoolRes.recommendations[0].movie.id).toBe(300);
    expect(singlePoolRes.recommendations[0].rank).toBe(1);
  });

  it('normalizes NaN AI scores, deduplicates pool items, and enforces floor on Gemini provider', async () => {
    const poolWithDuplicates: Movie[] = [
      ...Array.from({ length: 10 }, (_, i) => ({
        id: 400 + i,
        title: `Gem Film ${i}`,
        overview: 'Overview',
        release_date: '2020-01-01',
        vote_average: 8.1,
        vote_count: 1000,
        poster_path: `/g${i}.jpg`,
        backdrop_path: null,
        genres: [{ id: 878, name: 'Sci-Fi' }],
      })),
      // Duplicate entry in candidatePool
      {
        id: 402,
        title: 'Gem Film 2 Duplicate',
        overview: 'Overview',
        release_date: '2020-01-01',
        vote_average: 8.1,
        vote_count: 1000,
        poster_path: '/g2.jpg',
        backdrop_path: null,
        genres: [{ id: 878, name: 'Sci-Fi' }],
      },
    ];

    const geminiContent = JSON.stringify({
      taste_analysis: 'Gemini synthesis.',
      pool_rankings: [
        { id: 400, score: 'not-a-number', reason: 'Pick 1', serendipityType: 'safe_bet', highlightTags: ['Tag'] },
        { id: 400, score: 90, reason: 'Duplicate AI Pick', serendipityType: 'safe_bet', highlightTags: ['Tag'] },
        { id: 401, score: 78, reason: 'Pick 2', serendipityType: 'safe_bet', highlightTags: ['Tag'] },
      ],
      unconstrained_discoveries: [],
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: geminiContent }] } }],
        }),
      })
    );

    const res = await aiManager.generateRecommendations('gemini', {
      userRatings,
      candidatePool: poolWithDuplicates,
      serendipityLevel: 60,
      apiKey: 'gemini-test-key',
    });

    expect(res.recommendations).toHaveLength(MIN_RECOMMENDATIONS);
    const ids = res.recommendations.map((r) => r.movie.id);
    expect(new Set(ids).size).toBe(MIN_RECOMMENDATIONS);
    expect(ids.slice(0, 2)).toEqual([400, 401]);
    // Every AI score is finite and every backfilled item scores strictly below the lowest AI score (78)
    expect(res.recommendations.slice(0, 2).every((r) => Number.isFinite(r.score) && r.isAiCurated === true)).toBe(true);
    expect(res.recommendations.slice(2).every((r) => r.score < 78 && r.isAiCurated === undefined)).toBe(true);
    expect(res.usedProvider).toBe('Google Gemini AI');
  });
});
