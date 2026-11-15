// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  readRecommendationCache,
  writeRecommendationCache,
} from '../recommendationCache';
import { Movie, Recommendation } from '../../types';
import {
  STORAGE_KEYS,
  clearInMemoryStoreForTesting,
  safeSetItem,
} from '../../services/storage';

const makeMovie = (id: number, title = `Film ${id}`): Movie => ({
  id,
  title,
  overview: '',
  poster_path: null,
  backdrop_path: null,
  release_date: '2020-01-01',
  vote_average: 8,
  vote_count: 100,
  genres: [],
});

const makeRec = (
  movie: Movie,
  rank: number,
  overrides: Partial<Recommendation> = {}
): Recommendation => ({
  movie,
  score: 90 - rank,
  rank,
  reason: `Reason for ${movie.title}`,
  serendipityType: 'safe_bet',
  highlightTags: ['Drama'],
  ...overrides,
});

describe('readRecommendationCache lenient validation (CIN-59)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    vi.restoreAllMocks();
  });

  it('filters out invalid recommendations among valid ones while preserving order', () => {
    const rec1 = makeRec(makeMovie(1, 'First'), 1);
    const rec2 = makeRec(makeMovie(2, 'Second'), 2);
    const rec3 = makeRec(makeMovie(3, 'Third'), 3);

    safeSetItem(
      STORAGE_KEYS.CACHED_RECOMMENDATIONS,
      JSON.stringify({
        recommendations: [
          rec1,
          { movie: { id: 'not-a-number', title: 'Bad ID' }, score: 80, rank: 2, reason: '' },
          rec2,
          { movie: null, score: 75, rank: 3, reason: '' },
          null,
          rec3,
        ],
        generatedAt: 12345,
        usedProvider: 'gemini',
      })
    );

    const cached = readRecommendationCache();
    expect(cached).not.toBeNull();
    expect(cached?.recommendations.map((r) => r.movie.id)).toEqual([1, 2, 3]);
    expect(cached?.recommendations).toEqual([rec1, rec2, rec3]);
  });

  it('filters out recommendations with non-finite or missing movie.id while keeping valid ones', () => {
    const rec1 = makeRec(makeMovie(10, 'Ten'), 1);
    const rec2 = makeRec(makeMovie(20, 'Twenty'), 2);

    safeSetItem(
      STORAGE_KEYS.CACHED_RECOMMENDATIONS,
      JSON.stringify({
        recommendations: [
          rec1,
          { movie: { id: null }, score: 50, rank: 2, reason: '' },
          { movie: {}, score: 50, rank: 3, reason: '' },
          rec2,
        ],
        generatedAt: 5000,
        usedProvider: 'groq',
      })
    );

    const cached = readRecommendationCache();
    expect(cached).not.toBeNull();
    expect(cached?.recommendations.map((r) => r.movie.id)).toEqual([10, 20]);

    // Also exercise actual NaN / Infinity values that JSON.stringify would coerce to null
    safeSetItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, '{"placeholder":true}');
    const parseSpy = vi.spyOn(JSON, 'parse').mockReturnValueOnce({
      recommendations: [
        rec1,
        { movie: { id: Number.NaN }, score: 50, rank: 2, reason: '' },
        { movie: { id: Number.POSITIVE_INFINITY }, score: 40, rank: 3, reason: '' },
        { movie: { id: Number.NEGATIVE_INFINITY }, score: 30, rank: 4, reason: '' },
        rec2,
      ],
      generatedAt: 5000,
      usedProvider: 'groq',
    });

    const nonFiniteCached = readRecommendationCache();
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(nonFiniteCached).not.toBeNull();
    expect(nonFiniteCached?.recommendations.map((r) => r.movie.id)).toEqual([10, 20]);
  });

  it('defaults a missing or non-string usedProvider to empty string', () => {
    const rec1 = makeRec(makeMovie(1), 1);

    safeSetItem(
      STORAGE_KEYS.CACHED_RECOMMENDATIONS,
      JSON.stringify({
        recommendations: [rec1],
        generatedAt: 2000,
      })
    );

    const missingProvider = readRecommendationCache();
    expect(missingProvider).not.toBeNull();
    expect(missingProvider?.usedProvider).toBe('');
    expect(missingProvider?.recommendations).toEqual([rec1]);

    safeSetItem(
      STORAGE_KEYS.CACHED_RECOMMENDATIONS,
      JSON.stringify({
        recommendations: [rec1],
        generatedAt: 2000,
        usedProvider: null,
      })
    );

    const nullProvider = readRecommendationCache();
    expect(nullProvider).not.toBeNull();
    expect(nullProvider?.usedProvider).toBe('');
  });

  it('returns null when stored value is not an object with a recommendations array', () => {
    safeSetItem(
      STORAGE_KEYS.CACHED_RECOMMENDATIONS,
      JSON.stringify({
        recommendations: null,
        generatedAt: 1000,
        usedProvider: 'gemini',
      })
    );
    expect(readRecommendationCache()).toBeNull();

    safeSetItem(
      STORAGE_KEYS.CACHED_RECOMMENDATIONS,
      JSON.stringify({
        recommendations: 'not-an-array',
        generatedAt: 1000,
        usedProvider: 'gemini',
      })
    );
    expect(readRecommendationCache()).toBeNull();

    safeSetItem(
      STORAGE_KEYS.CACHED_RECOMMENDATIONS,
      JSON.stringify({
        generatedAt: 1000,
        usedProvider: 'gemini',
      })
    );
    expect(readRecommendationCache()).toBeNull();

    safeSetItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify([makeRec(makeMovie(1), 1)]));
    expect(readRecommendationCache()).toBeNull();

    safeSetItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(null));
    expect(readRecommendationCache()).toBeNull();
  });

  it('round-trips optional recommendation fields (bucket, sources, isAiCurated) as stored', () => {
    const recWithOptionalFields = makeRec(makeMovie(42, 'Curated Pick'), 1, {
      bucket: 'stretch',
      sources: ['seed_graph', 'keyword_affinity'],
      isAiCurated: true,
    });
    const recWildcard = makeRec(makeMovie(43, 'Wildcard Pick'), 2, {
      bucket: 'wildcard',
      sources: ['hidden_gem'],
      isAiCurated: false,
    });

    const written = writeRecommendationCache({
      recommendations: [recWithOptionalFields, recWildcard],
      generatedAt: 9999,
      usedProvider: 'openrouter',
      tasteAnalysis: 'Prefers atmospheric sci-fi',
      settingsFingerprint: 'fp-123',
      ratedCount: 12,
    });
    expect(written).toBe(true);

    const readBack = readRecommendationCache();
    expect(readBack).not.toBeNull();
    expect(readBack?.recommendations).toHaveLength(2);
    expect(readBack?.recommendations[0].bucket).toBe('stretch');
    expect(readBack?.recommendations[0].sources).toEqual(['seed_graph', 'keyword_affinity']);
    expect(readBack?.recommendations[0].isAiCurated).toBe(true);
    expect(readBack?.recommendations[1].bucket).toBe('wildcard');
    expect(readBack?.recommendations[1].sources).toEqual(['hidden_gem']);
    expect(readBack?.recommendations[1].isAiCurated).toBe(false);
    expect(readBack?.tasteAnalysis).toBe('Prefers atmospheric sci-fi');
    expect(readBack?.settingsFingerprint).toBe('fp-123');
    expect(readBack?.ratedCount).toBe(12);
  });

  it('handles empty string storage, empty recommendations array, and single-item caches', () => {
    safeSetItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, '');
    expect(readRecommendationCache()).toBeNull();

    safeSetItem(
      STORAGE_KEYS.CACHED_RECOMMENDATIONS,
      JSON.stringify({ recommendations: [] })
    );
    expect(readRecommendationCache()).toEqual({
      recommendations: [],
      generatedAt: 0,
      usedProvider: '',
    });

    safeSetItem(
      STORAGE_KEYS.CACHED_RECOMMENDATIONS,
      JSON.stringify({
        recommendations: [{ movie: { id: 'bad' }, score: 50, rank: 1, reason: '' }],
        generatedAt: 777,
        usedProvider: 'gemini',
      })
    );
    expect(readRecommendationCache()).toEqual({
      recommendations: [],
      generatedAt: 777,
      usedProvider: 'gemini',
    });
  });
});
