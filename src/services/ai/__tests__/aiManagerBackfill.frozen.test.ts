// FROZEN acceptance tests for CIN-31. Do not edit or weaken.
//
// Interface contract (CIN-31, hardened 8-recommendation backfill) in aiManager.generateRecommendations:
//  - Recommendation (src/types) has optional `origin?: 'ai' | 'local_backfill'`. Every backfilled item has
//    origin === 'local_backfill'; AI-provided items never have that value.
//  - Backfill score = max(1, min(localScore, minAiScore - 1)), where a non-finite localScore counts as 50.
//    The lower bound 1 wins when minAiScore - 1 < 1 (minAiScore of 1 or 2 gives backfill score 1).
//  - minAiScore is computed only over AI recommendations whose ORIGINAL score is a finite number. A missing or
//    non-finite AI score neither lowers nor raises the anchor. If no AI score is finite there is no upper
//    anchor (only the lower bound 1 applies). The AI rec itself is still kept (its own score is unspecified).
//  - If the local backfill call throws a non-abort error, the AI result is kept as-is (no backfill, no
//    error, usedProvider is the AI provider name, never a Fallback). AbortError is still rethrown.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { aiManager } from '../aiManager';
import type { IAIProvider, RecommendationRequest } from '../types';
import type { Movie, Recommendation } from '../../../types';

const mkMovie = (id: number): Movie => ({
  id,
  title: `Film ${id}`,
  overview: '',
  release_date: '2005-01-01',
  vote_average: 7,
  vote_count: 500,
  poster_path: null,
  backdrop_path: null,
  genres: [],
});

const mkRec = (id: number, score: number): Recommendation => ({
  movie: mkMovie(id),
  score,
  rank: 0,
  reason: 'r',
  serendipityType: 'safe_bet',
  highlightTags: [],
  isAiCurated: true,
});

const pool = Array.from({ length: 20 }, (_, i) => mkMovie(100 + i));

const request: RecommendationRequest = {
  userRatings: [],
  candidatePool: pool,
  serendipityLevel: 50,
  preferredEras: [],
  apiKey: 'sk-or-test-key',
};

const original = {
  openrouter: aiManager.getProvider('openrouter'),
  local: aiManager.getProvider('local'),
};

function install(aiRecs: Recommendation[], localImpl: IAIProvider['generateRecommendations']) {
  aiManager.registerProvider({
    id: 'openrouter',
    name: 'Fake OpenRouter',
    description: '',
    generateRecommendations: async () => ({ recommendations: aiRecs }),
    testConnection: async () => ({ success: true, message: '' }),
  });
  aiManager.registerProvider({
    id: 'local',
    name: 'Fake Local',
    description: '',
    generateRecommendations: localImpl,
    testConnection: async () => ({ success: true, message: '' }),
  });
}

const localWithScores = (scores: number[]): IAIProvider['generateRecommendations'] => async (req) => ({
  recommendations: req.candidatePool.slice(0, scores.length).map((m, i) => ({
    ...mkRec(m.id, scores[i]),
    isAiCurated: false,
  })),
});

describe('CIN-31: hardened backfill (aiManager)', () => {
  afterEach(() => {
    aiManager.registerProvider(original.openrouter);
    aiManager.registerProvider(original.local);
    vi.restoreAllMocks();
  });

  it('marks backfilled items with origin local_backfill and leaves AI items unmarked', async () => {
    install([mkRec(1, 90), mkRec(2, 80)], localWithScores([70, 60, 50, 40, 30, 20, 10]));
    const res = await aiManager.generateRecommendations('openrouter', request);
    expect(res.recommendations).toHaveLength(8);
    const ai = res.recommendations.filter((r) => r.movie.id === 1 || r.movie.id === 2);
    const back = res.recommendations.filter((r) => r.movie.id !== 1 && r.movie.id !== 2);
    expect(back).toHaveLength(6);
    expect(back.every((r) => r.origin === 'local_backfill')).toBe(true);
    expect(ai.every((r) => r.origin !== 'local_backfill')).toBe(true);
  });

  it('clamps backfill scores to 1..(minAiScore - 1)', async () => {
    install([mkRec(1, 90), mkRec(2, 80)], localWithScores([95, 60, 0, -20, 79, 10, Number.NaN]));
    const res = await aiManager.generateRecommendations('openrouter', request);
    const back = res.recommendations.filter((r) => r.origin === 'local_backfill');
    expect(back).toHaveLength(6);
    for (const r of back) {
      expect(r.score).toBeGreaterThanOrEqual(1);
      expect(r.score).toBeLessThanOrEqual(79);
    }
    const byId = new Map(back.map((r) => [r.movie.id, r.score]));
    expect(byId.get(100)).toBe(79); // 95 capped to minAiScore - 1
    expect(byId.get(101)).toBe(60); // in range, untouched
    expect(byId.get(102)).toBe(1); // 0 raised to the floor
    expect(byId.get(103)).toBe(1); // negative raised to the floor
  });

  it('minAiScore of 2 gives backfill score exactly 1', async () => {
    install([mkRec(1, 5), mkRec(2, 2)], localWithScores([90, 50, 30, 20, 10, 5]));
    const res = await aiManager.generateRecommendations('openrouter', request);
    const back = res.recommendations.filter((r) => r.origin === 'local_backfill');
    expect(back.length).toBeGreaterThan(0);
    expect(back.every((r) => r.score === 1)).toBe(true);
  });

  it('minAiScore of 1 clamps backfill to 1 (lower bound wins), never 0 or negative', async () => {
    install([mkRec(1, 1), mkRec(2, 4)], localWithScores([90, 50, 30, 20, 10, 5]));
    const res = await aiManager.generateRecommendations('openrouter', request);
    const back = res.recommendations.filter((r) => r.origin === 'local_backfill');
    expect(back.length).toBeGreaterThan(0);
    expect(back.every((r) => r.score === 1)).toBe(true);
  });

  it('a throwing backfill keeps the AI picks instead of falling back to the generic result', async () => {
    install([mkRec(1, 90), mkRec(2, 80), mkRec(3, 70)], async () => {
      throw new Error('local engine exploded');
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await aiManager.generateRecommendations('openrouter', request);
    expect(res.recommendations.map((r) => r.movie.id)).toEqual([1, 2, 3]);
    expect(res.recommendations.every((r) => r.isAiCurated === true)).toBe(true);
    expect(res.usedProvider).toBe('Fake OpenRouter');
    expect(res.usedProvider).not.toContain('Fallback');
    expect(res.error).toBeUndefined();
  });

  it('AbortError from the backfill is still rethrown', async () => {
    install([mkRec(1, 90)], async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(aiManager.generateRecommendations('openrouter', request)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('a non-finite AI score does not lower the anchor', async () => {
    // Old behaviour mapped NaN to 85, giving anchor 85 and a cap of 84. Finite scores are 95 and 92.
    install([mkRec(1, 95), mkRec(2, 92), mkRec(3, Number.NaN)], localWithScores([91, 40, 30, 20, 10]));
    const res = await aiManager.generateRecommendations('openrouter', request);
    const back = res.recommendations.filter((r) => r.origin === 'local_backfill');
    expect(back.find((r) => r.movie.id === 100)?.score).toBe(91);
  });

  it('a non-finite AI score does not raise the anchor', async () => {
    install(
      [mkRec(1, 60), mkRec(2, Number.NaN), mkRec(3, Number.POSITIVE_INFINITY)],
      localWithScores([90, 50, 40, 30, 20, 10])
    );
    const res = await aiManager.generateRecommendations('openrouter', request);
    const back = res.recommendations.filter((r) => r.origin === 'local_backfill');
    expect(back.length).toBeGreaterThan(0);
    expect(back.every((r) => r.score <= 59)).toBe(true);
    expect(back.find((r) => r.movie.id === 100)?.score).toBe(59);
  });

  it('with no finite AI score there is no upper anchor, only the lower bound of 1', async () => {
    install([mkRec(1, Number.NaN)], localWithScores([90, 50, 0, 30, 20, 10, 5, 4]));
    const res = await aiManager.generateRecommendations('openrouter', request);
    expect(res.recommendations.some((r) => r.movie.id === 1)).toBe(true);
    const back = res.recommendations.filter((r) => r.origin === 'local_backfill');
    expect(back.length).toBeGreaterThan(0);
    expect(back.find((r) => r.movie.id === 100)?.score).toBe(90);
    expect(back.find((r) => r.movie.id === 102)?.score).toBe(1);
  });
});
