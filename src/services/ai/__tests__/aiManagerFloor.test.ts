// FROZEN acceptance tests for CIN-28 (owner report CIN-27: "8 suggestions became 4").
// Do not edit or weaken these tests. Implement until they pass.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { aiManager, MIN_RECOMMENDATIONS } from '../aiManager';
import type { Movie, UserRating } from '../../../types';

const pool: Movie[] = Array.from({ length: 20 }, (_, i) => ({
  id: 500 + i,
  title: `Pool Film ${i}`,
  overview: '',
  release_date: `${2001 + i}-01-01`,
  vote_average: 7 + (i % 3) * 0.5,
  vote_count: 800 + i * 10,
  poster_path: `/p${i}.jpg`,
  backdrop_path: null,
  genres: [{ id: 18, name: 'Drama' }],
}));

const userRatings: UserRating[] = [
  { movieId: 1, title: 'Rated', rating: 9, posterPath: null, genres: ['Drama'], ratedAt: 1 },
];

function stubOpenRouter(poolIds: number[], scores: number[]) {
  const content = JSON.stringify({
    taste_analysis: 'Likes drama.',
    pool_rankings: poolIds.map((id, i) => ({
      id,
      score: scores[i],
      reason: 'AI pick',
      serendipityType: 'safe_bet',
      highlightTags: ['Pick'],
    })),
    unconstrained_discoveries: [],
  });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content } }] }),
    })
  );
}

const request = (candidatePool: Movie[]) => ({
  userRatings,
  candidatePool,
  serendipityLevel: 85,
  preferredEras: ['2000s', '2010s', '2020s'],
  apiKey: 'sk-or-test-key',
});

describe('CIN-28: recommendation count floor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('AC4: the floor is 8', () => {
    expect(MIN_RECOMMENDATIONS).toBe(8);
  });

  it('AC5: when the AI ranks only 4 pool films, the result is backfilled to at least 8 unique pool films', async () => {
    stubOpenRouter([503, 507, 511, 515], [95, 90, 88, 80]);

    const res = await aiManager.generateRecommendations('openrouter', request(pool));

    const ids = res.recommendations.map((r) => r.movie.id);
    expect(ids.length).toBeGreaterThanOrEqual(MIN_RECOMMENDATIONS);
    expect(new Set(ids).size).toBe(ids.length);
    const poolIds = new Set(pool.map((m) => m.id));
    expect(ids.every((id) => poolIds.has(id))).toBe(true);
    // The provider is still reported as the AI provider, not as a fallback.
    expect(res.usedProvider).not.toContain('Fallback');
    expect(res.error).toBeUndefined();
  });

  it('AC6: AI picks keep their order at the top; backfilled items score below every AI pick and are not marked AI-curated', async () => {
    stubOpenRouter([503, 507, 511, 515], [95, 90, 88, 80]);

    const res = await aiManager.generateRecommendations('openrouter', request(pool));

    expect(res.recommendations.slice(0, 4).map((r) => r.movie.id)).toEqual([503, 507, 511, 515]);
    expect(res.recommendations.slice(0, 4).every((r) => r.isAiCurated === true)).toBe(true);

    const backfill = res.recommendations.slice(4);
    expect(backfill.length).toBeGreaterThan(0);
    for (const rec of backfill) {
      expect(rec.isAiCurated).not.toBe(true);
      expect(rec.score).toBeLessThan(80);
    }
    // Ranks are 1..n in list order.
    expect(res.recommendations.map((r) => r.rank)).toEqual(res.recommendations.map((_, i) => i + 1));
  });

  it('AC7: when the AI already returns at least 8 pool films, nothing is added', async () => {
    const aiIds = pool.slice(0, 9).map((m) => m.id);
    stubOpenRouter(aiIds, aiIds.map((_, i) => 95 - i));

    const res = await aiManager.generateRecommendations('openrouter', request(pool));

    expect(res.recommendations.map((r) => r.movie.id)).toEqual(aiIds);
  });

  it('AC8: a pool smaller than the floor returns every pool film once, without error', async () => {
    const small = pool.slice(0, 5);
    stubOpenRouter([small[0].id], [90]);

    const res = await aiManager.generateRecommendations('openrouter', request(small));

    const ids = res.recommendations.map((r) => r.movie.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(small.map((m) => m.id).sort());
  });
});
