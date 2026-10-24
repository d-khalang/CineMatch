// FROZEN acceptance tests for CIN-31. Do not edit or weaken.
//
// Interface contract (CIN-31, store final ordering and era filter) in generateRankings (useMovieStore):
//  - Recommendations with origin === 'local_backfill' ALWAYS sort after every other recommendation (AI pool
//    picks and hydrated AI discoveries), regardless of score. Within each group order is score descending.
//    ranks are 1..n in final order.
//  - When aiSettings.preferredEras is non-empty (entries like '1990s'), hydrated unconstrained AI discoveries
//    whose movie release decade is not in preferredEras are dropped. Pool recommendations are not filtered
//    by this rule. When preferredEras is empty, no discovery is dropped for era reasons.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MovieStoreProvider, useMovieStore } from '../useMovieStore';
import { Movie, Recommendation } from '../../types';
import { clearInMemoryStoreForTesting } from '../../services/storage';
import { credentialStore } from '../../services/credentialStore';

const mocks = vi.hoisted(() => ({
  getPool: vi.fn(),
  hydrate: vi.fn(),
  generate: vi.fn(),
}));

vi.mock('../../services/recommendation/candidateSources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/recommendation/candidateSources')>();
  return { ...actual, getCandidateRecommendationPool: mocks.getPool, hydrateBatchWithDiscoveries: mocks.hydrate };
});
vi.mock('../../services/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/tmdb')>();
  return { ...actual, getCandidateRecommendationPool: mocks.getPool, hydrateBatchWithDiscoveries: mocks.hydrate };
});
vi.mock('../../services/ai/aiManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/ai/aiManager')>();
  return { ...actual, aiManager: { ...actual.aiManager, generateRecommendations: mocks.generate } };
});

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MovieStoreProvider>{children}</MovieStoreProvider>
);

const makeMovie = (id: number, year = 2000): Movie => ({
  id,
  title: `Film ${id}`,
  overview: '',
  poster_path: null,
  backdrop_path: null,
  release_date: `${year}-01-01`,
  vote_average: 7,
  vote_count: 100,
  genres: [],
});

const makeRec = (id: number, score: number, extra: Partial<Recommendation> = {}): Recommendation => ({
  movie: makeMovie(id),
  score,
  rank: 0,
  reason: 'because',
  serendipityType: 'safe_bet',
  highlightTags: [],
  ...extra,
});

// Discovery titles are "Film <id>"; the hydrated movie year comes from the yearOf map.
const yearOf = new Map<number, number>();
const installHydrate = () =>
  mocks.hydrate.mockImplementation(async (items: Array<{ title: string }>) =>
    items.map((item) => {
      const id = Number(item.title.replace('Film ', ''));
      return { item, movie: makeMovie(id, yearOf.get(id) ?? 2000) };
    })
  );

const discovery = (id: number, score: number) => ({
  title: `Film ${id}`,
  year: '2000',
  score,
  reason: 'gem',
  highlightTags: [],
});

describe('CIN-31 backfill ordering and era filter (frozen)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    vi.restoreAllMocks();
    mocks.getPool.mockReset();
    mocks.hydrate.mockReset();
    mocks.generate.mockReset();
    yearOf.clear();
    credentialStore.setTmdbCredential('api_key', 'test-tmdb-key');
    mocks.getPool.mockResolvedValue([]);
    installHydrate();
  });

  it('backfill items sort after all 3 pool picks and all 10 discoveries, even when their scores are higher than some discoveries', async () => {
    // 3 AI pool picks, 5 backfill (scores 60..52 sit between discovery scores), 10 AI discoveries.
    const poolPicks = [makeRec(1, 90, { isAiCurated: true }), makeRec(2, 80, { isAiCurated: true }), makeRec(3, 70, { isAiCurated: true })];
    const backfill = [60, 58, 56, 54, 52].map((s, i) =>
      makeRec(20 + i, s, { origin: 'local_backfill' })
    );
    const discScores = [95, 85, 75, 65, 59, 57, 55, 53, 40, 30];
    mocks.generate.mockResolvedValue({
      recommendations: [...poolPicks, ...backfill],
      unconstrainedDiscoveries: discScores.map((s, i) => discovery(100 + i, s)),
      usedProvider: 'OpenRouter',
      tasteAnalysis: null,
    });

    const { result } = renderHook(() => useMovieStore(), { wrapper });
    act(() => {
      result.current.updateAISettings({ preferredEras: [] });
    });
    await act(async () => {
      await result.current.generateRankings();
    });

    const recs = result.current.recommendations;
    expect(recs).toHaveLength(18);
    const firstBackfill = recs.findIndex((r) => r.origin === 'local_backfill');
    expect(firstBackfill).toBe(13);
    expect(recs.slice(0, 13).every((r) => r.origin !== 'local_backfill')).toBe(true);
    expect(recs.slice(13).every((r) => r.origin === 'local_backfill')).toBe(true);
    // AI group in score order, backfill group in score order.
    expect(recs.slice(0, 13).map((r) => r.score)).toEqual(
      [95, 90, 85, 80, 75, 70, 65, 59, 57, 55, 53, 40, 30]
    );
    expect(recs.slice(13).map((r) => r.movie.id)).toEqual([20, 21, 22, 23, 24]);
    expect(recs.map((r) => r.rank)).toEqual(recs.map((_, i) => i + 1));
  });

  it('drops unconstrained discoveries outside the preferred eras, keeps pool recs and in-era discoveries', async () => {
    yearOf.set(101, 1995); // in era
    yearOf.set(102, 2005); // out of era
    yearOf.set(103, 1999); // in era
    yearOf.set(104, 1985); // out of era
    mocks.generate.mockResolvedValue({
      recommendations: [makeRec(1, 70, { isAiCurated: true })], // release 2000: pool recs are not era-filtered
      unconstrainedDiscoveries: [101, 102, 103, 104].map((id, i) => discovery(id, 90 - i)),
      usedProvider: 'OpenRouter',
      tasteAnalysis: null,
    });

    const { result } = renderHook(() => useMovieStore(), { wrapper });
    act(() => {
      result.current.updateAISettings({ preferredEras: ['1990s'] });
    });
    await act(async () => {
      await result.current.generateRankings();
    });

    const ids = result.current.recommendations.map((r) => r.movie.id);
    expect(ids).toEqual(expect.arrayContaining([1, 101, 103]));
    expect(ids).not.toContain(102);
    expect(ids).not.toContain(104);
    expect(ids).toHaveLength(3);
  });

  it('does not drop any discovery by era when no preferred eras are set', async () => {
    yearOf.set(101, 1995);
    yearOf.set(102, 2005);
    yearOf.set(103, 1950);
    mocks.generate.mockResolvedValue({
      recommendations: [makeRec(1, 70, { isAiCurated: true })],
      unconstrainedDiscoveries: [101, 102, 103].map((id, i) => discovery(id, 90 - i)),
      usedProvider: 'OpenRouter',
      tasteAnalysis: null,
    });

    const { result } = renderHook(() => useMovieStore(), { wrapper });
    act(() => {
      result.current.updateAISettings({ preferredEras: [] });
    });
    await act(async () => {
      await result.current.generateRankings();
    });

    const ids = result.current.recommendations.map((r) => r.movie.id);
    expect(ids).toEqual(expect.arrayContaining([1, 101, 102, 103]));
    expect(ids).toHaveLength(4);
  });
});
