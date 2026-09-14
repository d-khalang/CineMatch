import { describe, it, expect } from 'vitest';
import { aiManager } from '../aiManager';
import { Movie, UserRating } from '../../../types';

describe('aiManager Orchestrator and Fallback', () => {
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
});
