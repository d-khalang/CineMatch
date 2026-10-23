// FROZEN acceptance tests for CIN-24 part 1. Do not edit or weaken.
//
// Interface contract (CIN-24 part 1, data layer):
//  - src/types: HiddenFilm { movieId: number; reason: 'seen' | 'not_for_me'; hiddenAt: number; title?: string }
//  - src/services/storage: STORAGE_VERSION === 3; STORAGE_KEYS.HIDDEN_FILMS === 'cinematch_hidden_films_v3'
//    holding a JSON array of HiddenFilm. Migration keeps all existing data and starts with an empty list.
//  - useMovieStore() exposes:
//      hiddenFilms: HiddenFilm[]
//      hideFilm(movieId: number, reason: 'seen' | 'not_for_me', title?: string): void
//      restoreFilm(movieId: number): void
//    hiddenAt is Date.now() at hide time. Cap is 2000 entries; when full the oldest by hiddenAt is dropped.
//  - generateRankings excludes hidden ids exactly where rated ids are excluded: the excludeIds passed to
//    getCandidateRecommendationPool and the final filter (pool recs and AI unconstrained discoveries).
//  - hideFilm removes the film from the displayed recommendations (state and cached copy) immediately.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MovieStoreProvider, useMovieStore } from '../useMovieStore';
import { Movie, Recommendation } from '../../types';
import { safeGetItem, safeSetItem, STORAGE_KEYS, clearInMemoryStoreForTesting } from '../../services/storage';
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

const makeMovie = (id: number): Movie => ({
  id,
  title: `Film ${id}`,
  overview: '',
  poster_path: null,
  backdrop_path: null,
  release_date: '2000-01-01',
  vote_average: 7,
  vote_count: 100,
  genres: [],
});

const makeRec = (id: number, score = 80): Recommendation => ({
  movie: makeMovie(id),
  score,
  rank: 0,
  reason: 'because',
  serendipityType: 'safe_bet',
  highlightTags: [],
});

const seedCachedRecs = (ids: number[]) => {
  safeSetItem(
    STORAGE_KEYS.CACHED_RECOMMENDATIONS,
    JSON.stringify({
      recommendations: ids.map((id, i) => ({ ...makeRec(id), rank: i + 1 })),
      generatedAt: 1700000000000,
      usedProvider: 'local',
      tasteAnalysis: null,
    })
  );
};

const HIDDEN_ID = 500;

describe('CIN-24 hidden films (frozen)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    vi.restoreAllMocks();
    mocks.getPool.mockReset();
    mocks.hydrate.mockReset();
    mocks.generate.mockReset();
    credentialStore.setTmdbCredential('api_key', 'test-tmdb-key');
    mocks.getPool.mockResolvedValue([makeMovie(HIDDEN_ID), makeMovie(501)]);
    mocks.hydrate.mockResolvedValue([]);
    mocks.generate.mockResolvedValue({
      recommendations: [makeRec(HIDDEN_ID, 90), makeRec(501, 80)],
      usedProvider: 'local',
      tasteAnalysis: null,
    });
  });

  it('AC2: hideFilm persists and the hidden list is restored after unmount + remount', () => {
    const first = renderHook(() => useMovieStore(), { wrapper });
    expect(first.result.current.hiddenFilms).toEqual([]);
    act(() => {
      first.result.current.hideFilm(HIDDEN_ID, 'seen', 'Film 500');
    });
    expect(first.result.current.hiddenFilms).toHaveLength(1);
    expect(first.result.current.hiddenFilms[0]).toMatchObject({ movieId: HIDDEN_ID, reason: 'seen', title: 'Film 500' });
    expect(typeof first.result.current.hiddenFilms[0].hiddenAt).toBe('number');
    const stored = JSON.parse(safeGetItem(STORAGE_KEYS.HIDDEN_FILMS) || '[]');
    expect(stored.map((h: { movieId: number }) => h.movieId)).toEqual([HIDDEN_ID]);
    first.unmount();

    const second = renderHook(() => useMovieStore(), { wrapper });
    expect(second.result.current.hiddenFilms).toHaveLength(1);
    expect(second.result.current.hiddenFilms[0]).toMatchObject({ movieId: HIDDEN_ID, reason: 'seen', title: 'Film 500' });
    second.unmount();
  });

  it('AC3: hidden film never appears in generateRankings (pool rec) and its id is in excludeIds', async () => {
    const { result } = renderHook(() => useMovieStore(), { wrapper });
    act(() => {
      result.current.hideFilm(HIDDEN_ID, 'not_for_me');
    });
    await act(async () => {
      await result.current.generateRankings();
    });
    expect(mocks.getPool).toHaveBeenCalled();
    const options = mocks.getPool.mock.calls[0][0] as { excludeIds: Iterable<number> };
    expect(Array.from(options.excludeIds)).toContain(HIDDEN_ID);
    const ids = result.current.recommendations.map((r) => r.movie.id);
    expect(ids).not.toContain(HIDDEN_ID);
    expect(ids).toContain(501);
  });

  it('AC3: hidden film never appears when the AI returns it as an unconstrained discovery', async () => {
    mocks.generate.mockResolvedValue({
      recommendations: [makeRec(501, 70)],
      unconstrainedDiscoveries: [
        { title: 'Film 500', year: '2000', score: 99, reason: 'gem', highlightTags: [] },
        { title: 'Film 502', year: '2000', score: 60, reason: 'gem', highlightTags: [] },
      ],
      usedProvider: 'local',
      tasteAnalysis: null,
    });
    mocks.hydrate.mockImplementation(async (items: Array<{ title: string }>) =>
      items.map((item) => ({ item, movie: makeMovie(Number(item.title.replace('Film ', ''))) }))
    );
    const { result } = renderHook(() => useMovieStore(), { wrapper });
    act(() => {
      result.current.hideFilm(HIDDEN_ID, 'seen');
    });
    await act(async () => {
      await result.current.generateRankings();
    });
    const ids = result.current.recommendations.map((r) => r.movie.id);
    expect(ids).not.toContain(HIDDEN_ID);
    expect(ids).toEqual(expect.arrayContaining([501, 502]));
  });

  it('AC3: hidden film is still excluded after reload', async () => {
    const first = renderHook(() => useMovieStore(), { wrapper });
    act(() => {
      first.result.current.hideFilm(HIDDEN_ID, 'seen');
    });
    first.unmount();
    const { result } = renderHook(() => useMovieStore(), { wrapper });
    await act(async () => {
      await result.current.generateRankings();
    });
    const options = mocks.getPool.mock.calls[0][0] as { excludeIds: Iterable<number> };
    expect(Array.from(options.excludeIds)).toContain(HIDDEN_ID);
    expect(result.current.recommendations.map((r) => r.movie.id)).not.toContain(HIDDEN_ID);
  });

  it('AC4: restoreFilm removes it from the hidden list and it can appear again', async () => {
    const { result } = renderHook(() => useMovieStore(), { wrapper });
    act(() => {
      result.current.hideFilm(HIDDEN_ID, 'not_for_me');
    });
    act(() => {
      result.current.restoreFilm(HIDDEN_ID);
    });
    expect(result.current.hiddenFilms).toEqual([]);
    expect(JSON.parse(safeGetItem(STORAGE_KEYS.HIDDEN_FILMS) || '[]')).toEqual([]);
    await act(async () => {
      await result.current.generateRankings();
    });
    const options = mocks.getPool.mock.calls[0][0] as { excludeIds: Iterable<number> };
    expect(Array.from(options.excludeIds)).not.toContain(HIDDEN_ID);
    expect(result.current.recommendations.map((r) => r.movie.id)).toContain(HIDDEN_ID);
  });

  it('AC5: caps at 2000 entries and drops the oldest by hiddenAt', () => {
    let clock = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock++);
    const { result } = renderHook(() => useMovieStore(), { wrapper });
    for (let id = 1; id <= 2001; id++) {
      act(() => {
        result.current.hideFilm(id, 'seen');
      });
    }
    const ids = result.current.hiddenFilms.map((h) => h.movieId);
    expect(ids).toHaveLength(2000);
    expect(ids).not.toContain(1);
    expect(ids).toContain(2);
    expect(ids).toContain(2001);
    expect(JSON.parse(safeGetItem(STORAGE_KEYS.HIDDEN_FILMS) || '[]')).toHaveLength(2000);
  }, 60000);

  it('AC6: hideFilm removes the film from current recommendations immediately', () => {
    seedCachedRecs([HIDDEN_ID, 501, 502]);
    const { result } = renderHook(() => useMovieStore(), { wrapper });
    expect(result.current.recommendations.map((r) => r.movie.id)).toEqual([HIDDEN_ID, 501, 502]);
    act(() => {
      result.current.hideFilm(HIDDEN_ID, 'not_for_me');
    });
    expect(result.current.recommendations.map((r) => r.movie.id)).toEqual([501, 502]);
    const cached = JSON.parse(safeGetItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS) || '{}');
    expect(cached.recommendations.map((r: Recommendation) => r.movie.id)).toEqual([501, 502]);
  });

  it('AC7: the hide reason is preserved and distinguishable', () => {
    const first = renderHook(() => useMovieStore(), { wrapper });
    act(() => {
      first.result.current.hideFilm(1, 'seen');
    });
    act(() => {
      first.result.current.hideFilm(2, 'not_for_me');
    });
    const reasons = (hidden: { movieId: number; reason: string }[]) =>
      Object.fromEntries(hidden.map((h) => [h.movieId, h.reason]));
    expect(reasons(first.result.current.hiddenFilms)).toEqual({ 1: 'seen', 2: 'not_for_me' });
    first.unmount();
    const second = renderHook(() => useMovieStore(), { wrapper });
    expect(reasons(second.result.current.hiddenFilms)).toEqual({ 1: 'seen', 2: 'not_for_me' });
    second.unmount();
  });
});
