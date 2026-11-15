// FROZEN acceptance tests for CIN-47 (store integration). Do not edit or weaken.
//
// Interface contract:
//  - useMovieStore().hideFilms(entries: HiddenFilm[]): void  (batch hide)
//      Persists each entry exactly as given (hiddenAt is NOT overwritten with Date.now()),
//      replaces an existing entry with the same movieId, applies the 2000 cap (oldest by hiddenAt dropped),
//      persists to STORAGE_KEYS.HIDDEN_FILMS and removes hidden ids from displayed/cached recommendations,
//      exactly like hideFilm.
//  - Ids hidden through hideFilms are in the excludeIds passed to getCandidateRecommendationPool by generateRankings.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MovieStoreProvider, useMovieStore } from '../useMovieStore';
import { Movie, Recommendation, HiddenFilm } from '../../types';
import { safeGetItem, STORAGE_KEYS, clearInMemoryStoreForTesting } from '../../services/storage';
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

const seen = (movieId: number, hiddenAt: number): HiddenFilm => ({
  movieId,
  reason: 'seen',
  hiddenAt,
  title: `Film ${movieId}`,
});

describe('CIN-47 batch hide via store (frozen)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    vi.restoreAllMocks();
    mocks.getPool.mockReset();
    mocks.hydrate.mockReset();
    mocks.generate.mockReset();
    credentialStore.setTmdbCredential('api_key', 'test-tmdb-key');
    mocks.getPool.mockResolvedValue([makeMovie(700), makeMovie(701), makeMovie(702)]);
    mocks.hydrate.mockResolvedValue([]);
    mocks.generate.mockResolvedValue({
      recommendations: [makeRec(700, 90), makeRec(701, 80), makeRec(702, 70)],
      usedProvider: 'local',
      tasteAnalysis: null,
    });
  });

  it('persists entries as given, keeping each hiddenAt', () => {
    const { result } = renderHook(() => useMovieStore(), { wrapper });
    act(() => {
      result.current.hideFilms([seen(700, 1_500_000_000_000), seen(701, 0)]);
    });
    expect(result.current.hiddenFilms).toEqual([seen(700, 1_500_000_000_000), seen(701, 0)]);
    const stored = JSON.parse(safeGetItem(STORAGE_KEYS.HIDDEN_FILMS) || '[]') as HiddenFilm[];
    expect(stored.map((h) => [h.movieId, h.hiddenAt])).toEqual([
      [700, 1_500_000_000_000],
      [701, 0],
    ]);
  });

  it('batch-hidden ids are excluded by generateRankings and absent from recommendations', async () => {
    const { result } = renderHook(() => useMovieStore(), { wrapper });
    act(() => {
      result.current.hideFilms([seen(700, 10), seen(701, 20)]);
    });
    await act(async () => {
      await result.current.generateRankings();
    });
    const options = mocks.getPool.mock.calls[0][0] as { excludeIds: Iterable<number> };
    const excluded = Array.from(options.excludeIds);
    expect(excluded).toContain(700);
    expect(excluded).toContain(701);
    expect(excluded).not.toContain(702);
    const ids = result.current.recommendations.map((r) => r.movie.id);
    expect(ids).not.toContain(700);
    expect(ids).not.toContain(701);
    expect(ids).toContain(702);
  });

  it('replaces an existing entry with the same movieId and survives remount', () => {
    const first = renderHook(() => useMovieStore(), { wrapper });
    act(() => {
      first.result.current.hideFilm(700, 'not_for_me');
    });
    act(() => {
      first.result.current.hideFilms([seen(700, 42)]);
    });
    expect(first.result.current.hiddenFilms).toHaveLength(1);
    first.unmount();
    const second = renderHook(() => useMovieStore(), { wrapper });
    expect(second.result.current.hiddenFilms).toEqual([seen(700, 42)]);
  });

  it('applies the 2000 cap, dropping the oldest by hiddenAt', () => {
    const { result } = renderHook(() => useMovieStore(), { wrapper });
    const entries = Array.from({ length: 2003 }, (_, i) => seen(i + 1, 1000 + i));
    act(() => {
      result.current.hideFilms(entries);
    });
    expect(result.current.hiddenFilms).toHaveLength(2000);
    const ids = new Set(result.current.hiddenFilms.map((h) => h.movieId));
    expect(ids.has(1)).toBe(false);
    expect(ids.has(3)).toBe(false);
    expect(ids.has(4)).toBe(true);
    expect(ids.has(2003)).toBe(true);
  });
});
