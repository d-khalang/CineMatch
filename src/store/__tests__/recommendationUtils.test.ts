import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  matchesPreferredEras,
  sortAndRankRecommendations,
  coerceScore,
  clamp,
} from '../recommendationUtils';
import { MovieStoreProvider, useMovieStore } from '../useMovieStore';
import { Recommendation, Movie } from '../../types';
import { STORAGE_KEYS, clearInMemoryStoreForTesting, safeGetItem } from '../../services/storage';
import { credentialStore } from '../../services/credentialStore';
import { aiManager } from '../../services/ai/aiManager';

vi.mock('../../services/tmdb', () => ({
  IMAGE_BASE_URL: 'https://image.tmdb.org/t/p/w500',
  getMovieDetails: vi.fn().mockResolvedValue(null),
  hydrateBatchWithDiscoveries: vi.fn().mockImplementation(async (items: Array<{ title: string; score: number; release_date?: string; year?: string }>) =>
    items.map((item, idx) => ({
      item,
      movie: {
        id: 500 + idx,
        title: item.title,
        overview: '',
        release_date: item.release_date !== undefined ? item.release_date : (item.year ? `${item.year}-01-01` : '2020-01-01'),
        vote_average: 8.0,
        vote_count: 100,
        poster_path: null,
        backdrop_path: null,
        genres: [],
      } as Movie,
    }))
  ),
  getEraDateRange: vi.fn().mockImplementation((era: string) => {
    if (era === 'classic') return { gte: '1940-01-01', lte: '1959-12-31' };
    return null;
  }),
}));

vi.mock('../../services/credentialStore', () => ({
  credentialStore: {
    hasTmdb: vi.fn().mockReturnValue(true),
    getCredentials: vi.fn().mockReturnValue({ tmdbApiKey: 'test-key', geminiApiKey: 'test-key' }),
    getVersion: vi.fn().mockReturnValue(1),
    subscribe: vi.fn().mockReturnValue(() => {}),
    forgetAll: vi.fn(),
  },
}));

vi.mock('../../services/recommendation/candidateSources', () => ({
  getCandidateRecommendationPool: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../services/ai/aiManager', () => ({
  aiManager: {
    generateRecommendations: vi.fn(),
  },
}));

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
  React.createElement(MovieStoreProvider, { children });

const makeMovie = (id: number, release_date = '2020-01-01'): Movie => ({
  id,
  title: `Movie ${id}`,
  overview: '',
  release_date,
  vote_average: 8.0,
  vote_count: 100,
  poster_path: null,
  backdrop_path: null,
  genres: [],
});

const makeRec = (id: number, score: number, extra: Partial<Recommendation> = {}): Recommendation => ({
  movie: makeMovie(id),
  score,
  rank: 0,
  reason: 'Recommended',
  serendipityType: 'safe_bet',
  highlightTags: [],
  ...extra,
});

describe('recommendationUtils', () => {
  describe('clamp & coerceScore', () => {
    it('clamps values between min and max', () => {
      expect(clamp(50, 0, 100)).toBe(50);
      expect(clamp(-10, 0, 100)).toBe(0);
      expect(clamp(150, 0, 100)).toBe(100);
    });

    it('coerces finite numbers within 0-100 and clamps out-of-range values', () => {
      expect(coerceScore(85)).toBe(85);
      expect(coerceScore(0)).toBe(0);
      expect(coerceScore(100)).toBe(100);
      expect(coerceScore(-5)).toBe(0);
      expect(coerceScore(140)).toBe(100);
    });

    it('coerces NaN, undefined, null, and non-finite values to 0', () => {
      expect(coerceScore(NaN)).toBe(0);
      expect(coerceScore(undefined)).toBe(0);
      expect(coerceScore(null)).toBe(0);
      expect(coerceScore(Infinity)).toBe(0);
      expect(coerceScore(-Infinity)).toBe(0);
      expect(coerceScore('85')).toBe(0);
    });
  });

  describe('matchesPreferredEras (CIN-43 AC1)', () => {
    it('matchesPreferredEras returns true for missing and garbage dates when eras are set, and still filters correctly dated films', () => {
      const preferred = ['90s'];

      // Missing dates when eras are set
      expect(matchesPreferredEras(undefined, preferred)).toBe(true);
      expect(matchesPreferredEras('', preferred)).toBe(true);
      expect(matchesPreferredEras(null as unknown as string, preferred)).toBe(true);

      // Garbage dates when eras are set
      expect(matchesPreferredEras('garbage', preferred)).toBe(true);
      expect(matchesPreferredEras('unknown date', preferred)).toBe(true);
      expect(matchesPreferredEras('TBD', preferred)).toBe(true);
      expect(matchesPreferredEras('no-digits-here', preferred)).toBe(true);

      // Still filters correctly dated films: in era (true) vs out of era (false)
      expect(matchesPreferredEras('1994-05-20', preferred)).toBe(true);
      expect(matchesPreferredEras('2015-08-10', preferred)).toBe(false);
    });

    it('returns true when preferredEras is empty or undefined', () => {
      expect(matchesPreferredEras('2022-05-10', [])).toBe(true);
      expect(matchesPreferredEras('2022-05-10', undefined)).toBe(true);
      expect(matchesPreferredEras(undefined, [])).toBe(true);
    });

    it('returns true for missing and garbage dates when eras are set', () => {
      const preferred = ['90s', '2000s'];

      // Missing dates
      expect(matchesPreferredEras(undefined, preferred)).toBe(true);
      expect(matchesPreferredEras('', preferred)).toBe(true);
      expect(matchesPreferredEras(null as unknown as string, preferred)).toBe(true);

      // Garbage dates that cannot be parsed
      expect(matchesPreferredEras('garbage', preferred)).toBe(true);
      expect(matchesPreferredEras('unknown date', preferred)).toBe(true);
      expect(matchesPreferredEras('TBD', preferred)).toBe(true);
      expect(matchesPreferredEras('no-digits-here', preferred)).toBe(true);
    });

    it('still filters correctly dated films according to preferred eras', () => {
      const preferred = ['90s'];

      // In era (90s / 1990s)
      expect(matchesPreferredEras('1994-05-20', preferred)).toBe(true);
      expect(matchesPreferredEras('1990-01-01', preferred)).toBe(true);
      expect(matchesPreferredEras('1999-12-31', preferred)).toBe(true);
      expect(matchesPreferredEras('1995', preferred)).toBe(true);

      // Out of era
      expect(matchesPreferredEras('2015-08-10', preferred)).toBe(false);
      expect(matchesPreferredEras('1985-07-03', preferred)).toBe(false);
      expect(matchesPreferredEras('2000-01-01', preferred)).toBe(false);
    });

    it('supports 4-digit era notation (e.g. 1990s)', () => {
      const preferred = ['1990s'];
      expect(matchesPreferredEras('1995-05-10', preferred)).toBe(true);
      expect(matchesPreferredEras('2015-05-10', preferred)).toBe(false);
    });

    it('supports custom range lookups via getEraDateRange', () => {
      const preferred = ['classic'];
      expect(matchesPreferredEras('1952-04-11', preferred)).toBe(true);
      expect(matchesPreferredEras('1982-04-11', preferred)).toBe(false);
    });
  });

  describe('sortAndRankRecommendations', () => {
    it('sorts non-backfill first by score descending, then backfill by score descending, re-ranking 1..n', () => {
      const recs: Recommendation[] = [
        makeRec(1, 70),
        makeRec(2, 90, { origin: 'local_backfill' }),
        makeRec(3, 80),
        makeRec(4, 60, { origin: 'local_backfill' }),
      ];

      const ranked = sortAndRankRecommendations(recs);
      expect(ranked.map((r) => r.movie.id)).toEqual([3, 1, 2, 4]);
      expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    });
  });

  describe('Store acceptance of finite scores (CIN-43 AC2)', () => {
    beforeEach(() => {
      localStorage.clear();
      clearInMemoryStoreForTesting();
      vi.clearAllMocks();
    });

    it('normalises NaN, undefined, -5 and 140 scores to 0, 0, 0 and 100 after the store accepts them, and orders by normalised score', async () => {
      vi.mocked(aiManager.generateRecommendations).mockResolvedValueOnce({
        recommendations: [
          makeRec(1, NaN),
          makeRec(2, undefined as unknown as number),
          makeRec(3, -5),
          makeRec(4, 140),
          makeRec(5, 75),
        ],
        usedProvider: 'gemini',
      });

      const { result } = renderHook(() => useMovieStore(), { wrapper });

      await act(async () => {
        await result.current.generateRankings();
      });

      const recs = result.current.recommendations;
      expect(recs).toHaveLength(5);

      // Verify scores are normalised
      const rec4 = recs.find((r) => r.movie.id === 4)!;
      const rec5 = recs.find((r) => r.movie.id === 5)!;
      const rec1 = recs.find((r) => r.movie.id === 1)!;
      const rec2 = recs.find((r) => r.movie.id === 2)!;
      const rec3 = recs.find((r) => r.movie.id === 3)!;

      expect(rec4.score).toBe(100);
      expect(rec5.score).toBe(75);
      expect(rec1.score).toBe(0);
      expect(rec2.score).toBe(0);
      expect(rec3.score).toBe(0);

      // Verify the list order is by normalised score descending
      expect(recs.map((r) => r.score)).toEqual([100, 75, 0, 0, 0]);
      expect(recs.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);

      // Verify cached recommendations also store the exact normalised values
      const cachedRaw = safeGetItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS);
      expect(cachedRaw).not.toBeNull();
      const parsedCached = JSON.parse(cachedRaw!);
      expect(parsedCached.recommendations.map((r: Recommendation) => r.score)).toEqual([100, 75, 0, 0, 0]);
    });

    it('normalises unconstrained discovery scores at the store acceptance boundary', async () => {
      vi.mocked(aiManager.generateRecommendations).mockResolvedValueOnce({
        recommendations: [],
        unconstrainedDiscoveries: [
          {
            title: 'Discovery 1',
            score: NaN,
            reason: 'gem',
            highlightTags: [],
          },
          {
            title: 'Discovery 2',
            score: 150,
            reason: 'gem',
            highlightTags: [],
          },
        ],
        usedProvider: 'gemini',
      });

      const { result } = renderHook(() => useMovieStore(), { wrapper });

      await act(async () => {
        await result.current.generateRankings();
      });

      const recs = result.current.recommendations;
      expect(recs).toHaveLength(2);
      expect(recs.map((r) => r.score)).toEqual([100, 0]);
      expect(recs.map((r) => r.rank)).toEqual([1, 2]);
    });

    it('keeps unconstrained discoveries with missing or garbage release dates when preferredEras is set', async () => {
      vi.mocked(aiManager.generateRecommendations).mockResolvedValueOnce({
        recommendations: [],
        unconstrainedDiscoveries: [
          {
            title: '90s Movie',
            year: '1995',
            release_date: '1995-05-10',
            score: 95,
            reason: 'in era',
            highlightTags: [],
          },
          {
            title: 'Missing Date Movie',
            release_date: '',
            score: 90,
            reason: 'no date available',
            highlightTags: [],
          },
          {
            title: 'Garbage Date Movie',
            release_date: 'unknown-date',
            score: 85,
            reason: 'unparseable date',
            highlightTags: [],
          },
          {
            title: '2010s Movie',
            year: '2015',
            release_date: '2015-08-10',
            score: 80,
            reason: 'out of era',
            highlightTags: [],
          },
        ],
        usedProvider: 'gemini',
      });

      const { result } = renderHook(() => useMovieStore(), { wrapper });

      act(() => {
        result.current.updateAISettings({ preferredEras: ['90s'] });
      });

      await act(async () => {
        await result.current.generateRankings();
      });

      const recs = result.current.recommendations;
      // 90s (in era), missing date, and garbage date are kept; 2015 is dropped
      expect(recs).toHaveLength(3);
      expect(recs.map((r) => r.movie.title)).toEqual([
        '90s Movie',
        'Missing Date Movie',
        'Garbage Date Movie',
      ]);
      expect(recs.map((r) => r.score)).toEqual([95, 90, 85]);
      expect(recs.map((r) => r.rank)).toEqual([1, 2, 3]);
    });
  });
});
