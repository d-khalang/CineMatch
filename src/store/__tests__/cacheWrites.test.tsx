import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MovieStoreProvider, useMovieStore } from '../useMovieStore';
import {
  readRecommendationCache,
  writeRecommendationCache,
} from '../recommendationCache';
import { Movie, Recommendation } from '../../types';
import {
  STORAGE_KEYS,
  clearInMemoryStoreForTesting,
  safeSetItem,
  safeRemoveItem,
} from '../../services/storage';
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

const strictWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <React.StrictMode>
    <MovieStoreProvider>{children}</MovieStoreProvider>
  </React.StrictMode>
);

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

const makeRec = (movie: Movie, rank: number, score = 90): Recommendation => ({
  movie,
  score,
  rank,
  reason: `Reason for ${movie.title}`,
  serendipityType: 'safe_bet',
  highlightTags: ['Drama'],
});

describe('Store cache writes and StrictMode resilience (CIN-50)', () => {
  const movie1 = makeMovie(1, 'Film 1');
  const movie2 = makeMovie(2, 'Film 2');
  const rec1 = makeRec(movie1, 1, 90);
  const rec2 = makeRec(movie2, 2, 85);

  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    credentialStore.forgetAll();
    vi.restoreAllMocks();
  });

  it('wrapping the provider in <React.StrictMode>, one dismissRecommendation call produces exactly one localStorage.setItem for the cache key', () => {
    writeRecommendationCache({
      recommendations: [rec1, rec2],
      generatedAt: 1000,
      usedProvider: 'gemini',
      settingsFingerprint: 'fp-initial',
      ratedCount: 5,
    });

    const { result } = renderHook(() => useMovieStore(), { wrapper: strictWrapper });
    expect(result.current.recommendations).toHaveLength(2);

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    act(() => {
      result.current.dismissRecommendation(1);
    });

    const cacheWrites = setItemSpy.mock.calls.filter(
      ([key]) => key === STORAGE_KEYS.CACHED_RECOMMENDATIONS
    );

    expect(cacheWrites).toHaveLength(1);
    expect(result.current.recommendations).toHaveLength(1);
    expect(result.current.recommendations[0].movie.id).toBe(2);
    expect(result.current.recommendations[0].rank).toBe(1);

    const updatedCache = readRecommendationCache();
    expect(updatedCache?.recommendations).toHaveLength(1);
    expect(updatedCache?.recommendations[0].movie.id).toBe(2);
    expect(updatedCache?.recommendations[0].rank).toBe(1);
    expect(updatedCache?.settingsFingerprint).toBe('fp-initial');
    expect(updatedCache?.ratedCount).toBe(5);
  });

  it('wrapping the provider in <React.StrictMode>, one hideFilm call produces exactly one localStorage.setItem for the cache key', () => {
    writeRecommendationCache({
      recommendations: [rec1, rec2],
      generatedAt: 1000,
      usedProvider: 'gemini',
      settingsFingerprint: 'fp-initial',
      ratedCount: 5,
    });

    const { result } = renderHook(() => useMovieStore(), { wrapper: strictWrapper });
    expect(result.current.recommendations).toHaveLength(2);

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    act(() => {
      result.current.hideFilm(1, 'seen', 'Film 1');
    });

    const cacheWrites = setItemSpy.mock.calls.filter(
      ([key]) => key === STORAGE_KEYS.CACHED_RECOMMENDATIONS
    );

    expect(cacheWrites).toHaveLength(1);
    expect(result.current.recommendations).toHaveLength(1);
    expect(result.current.recommendations[0].movie.id).toBe(2);
    expect(result.current.recommendations[0].rank).toBe(1);

    const updatedCache = readRecommendationCache();
    expect(updatedCache?.recommendations).toHaveLength(1);
    expect(updatedCache?.recommendations[0].movie.id).toBe(2);
    expect(updatedCache?.settingsFingerprint).toBe('fp-initial');
    expect(updatedCache?.ratedCount).toBe(5);
  });

  it('start a generation, call dismissRecommendation while it is pending, resolve it, and the final cache holds the generation result with settingsFingerprint and ratedCount from that run', async () => {
    credentialStore.setTmdbCredential('api_key', 'test-tmdb-key');

    const ratedMovie: Movie = {
      id: 99,
      title: 'Rated Film',
      overview: '',
      poster_path: null,
      backdrop_path: null,
      release_date: '2020-01-01',
      vote_average: 8.5,
      vote_count: 500,
      genres: [{ id: 18, name: 'Drama' }],
    };

    writeRecommendationCache({
      recommendations: [rec1, rec2],
      generatedAt: 500,
      usedProvider: 'gemini',
      settingsFingerprint: 'old-initial-fingerprint',
      ratedCount: 0,
    });

    const candidatePool = [
      makeMovie(201, 'Candidate 201'),
      makeMovie(202, 'Candidate 202'),
    ];
    mocks.getPool.mockResolvedValue(candidatePool);

    let resolveAi!: (value: any) => void;
    const pendingAiPromise = new Promise((resolve) => {
      resolveAi = resolve;
    });
    mocks.generate.mockReturnValue(pendingAiPromise);

    const { result } = renderHook(() => useMovieStore(), { wrapper: strictWrapper });
    expect(result.current.recommendations).toHaveLength(2);

    // Rate a movie so ratings list has 1 entry with rating >= 7
    await act(async () => {
      await result.current.setRating(ratedMovie, 9);
    });

    // Start generation (in-flight)
    let generationPromise: Promise<void>;
    act(() => {
      generationPromise = result.current.generateRankings();
    });
    expect(result.current.isGeneratingRecs).toBe(true);

    // While generation is pending, dismiss recommendation 1
    act(() => {
      result.current.dismissRecommendation(1);
    });
    expect(result.current.recommendations).toHaveLength(1);
    expect(result.current.recommendations[0].movie.id).toBe(2);

    // Now resolve the in-flight generation
    const newGeneratedMovie = makeMovie(201, 'Generated Film 201');
    await act(async () => {
      resolveAi({
        recommendations: [
          makeRec(newGeneratedMovie, 1, 95),
        ],
        usedProvider: 'gemini',
        tasteAnalysis: 'Generated taste analysis',
      });
      await generationPromise;
    });

    expect(result.current.isGeneratingRecs).toBe(false);
    expect(result.current.recommendations).toHaveLength(1);
    expect(result.current.recommendations[0].movie.id).toBe(201);

    // Final cache check
    const finalCache = readRecommendationCache();
    expect(finalCache).not.toBeNull();
    expect(finalCache?.recommendations).toHaveLength(1);
    expect(finalCache?.recommendations[0].movie.id).toBe(201);
    expect(finalCache?.settingsFingerprint).toBeDefined();
    expect(finalCache?.settingsFingerprint).not.toBe('old-initial-fingerprint');
    expect(finalCache?.ratedCount).toBe(1);
    expect(finalCache?.usedProvider).toBe('gemini');
    expect(finalCache?.tasteAnalysis).toBe('Generated taste analysis');
  });

  it('filters out films hidden while generation is in flight from final recommendations', async () => {
    credentialStore.setTmdbCredential('api_key', 'test-tmdb-key');

    const ratedMovie = makeMovie(99, 'Rated Film');
    const movie201 = makeMovie(201, 'Candidate 201');
    const movie202 = makeMovie(202, 'Candidate 202');

    mocks.getPool.mockResolvedValue([movie201, movie202]);

    let resolveAi!: (value: any) => void;
    const pendingAiPromise = new Promise((resolve) => {
      resolveAi = resolve;
    });
    mocks.generate.mockReturnValue(pendingAiPromise);

    const { result } = renderHook(() => useMovieStore(), { wrapper: strictWrapper });

    await act(async () => {
      await result.current.setRating(ratedMovie, 9);
    });

    let generationPromise: Promise<void>;
    act(() => {
      generationPromise = result.current.generateRankings();
    });
    expect(result.current.isGeneratingRecs).toBe(true);

    // While generation is in flight, user hides movie 201
    act(() => {
      result.current.hideFilm(201, 'not_for_me', 'Candidate 201');
    });

    // Resolve AI generation which returned both 201 and 202
    await act(async () => {
      resolveAi({
        recommendations: [
          makeRec(movie201, 1, 95),
          makeRec(movie202, 2, 85),
        ],
        usedProvider: 'gemini',
      });
      await generationPromise;
    });

    // movie201 must have been excluded because it was hidden while generation was in-flight
    expect(result.current.recommendations).toHaveLength(1);
    expect(result.current.recommendations[0].movie.id).toBe(202);

    const finalCache = readRecommendationCache();
    expect(finalCache?.recommendations).toHaveLength(1);
    expect(finalCache?.recommendations[0].movie.id).toBe(202);
  });

  it('dismiss with no cache, then remount: the dismissed film stays gone', () => {
    writeRecommendationCache({
      recommendations: [rec1, rec2],
      generatedAt: 1000,
      usedProvider: 'gemini',
      settingsFingerprint: 'fp-initial',
      ratedCount: 5,
    });

    const { result, unmount } = renderHook(() => useMovieStore(), { wrapper: strictWrapper });
    expect(result.current.recommendations).toHaveLength(2);

    safeRemoveItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS);
    expect(readRecommendationCache()).toBeNull();

    act(() => {
      result.current.dismissRecommendation(1);
    });

    expect(result.current.recommendations).toHaveLength(1);
    expect(result.current.recommendations[0].movie.id).toBe(2);

    const updatedCache = readRecommendationCache();
    expect(updatedCache).not.toBeNull();
    expect(updatedCache?.recommendations).toHaveLength(1);
    expect(updatedCache?.recommendations[0].movie.id).toBe(2);
    expect(updatedCache?.recommendations[0].rank).toBe(1);
    expect(updatedCache?.generatedAt).toBe(1000);
    expect(updatedCache?.usedProvider).toBe('gemini');
    expect(updatedCache?.settingsFingerprint).toBe('fp-initial');
    expect(updatedCache?.ratedCount).toBe(5);

    unmount();

    const { result: remountResult } = renderHook(() => useMovieStore(), { wrapper: strictWrapper });
    expect(remountResult.current.recommendations).toHaveLength(1);
    expect(remountResult.current.recommendations[0].movie.id).toBe(2);
    expect(remountResult.current.cachedRecsTimestamp).toBe(1000);
    expect(remountResult.current.lastProviderUsed).toBe('gemini');
    expect(remountResult.current.lastRunFingerprint).toBe('fp-initial');
    expect(remountResult.current.lastRunRatedCount).toBe(5);
  });

  it('the same with an invalid cache (garbage JSON)', () => {
    writeRecommendationCache({
      recommendations: [rec1, rec2],
      generatedAt: 1000,
      usedProvider: 'gemini',
      settingsFingerprint: 'fp-initial',
      ratedCount: 5,
    });

    const { result, unmount } = renderHook(() => useMovieStore(), { wrapper: strictWrapper });
    expect(result.current.recommendations).toHaveLength(2);

    safeSetItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, 'not-valid-json{{{');
    expect(readRecommendationCache()).toBeNull();

    act(() => {
      result.current.dismissRecommendation(1);
    });

    expect(result.current.recommendations).toHaveLength(1);
    expect(result.current.recommendations[0].movie.id).toBe(2);

    const updatedCache = readRecommendationCache();
    expect(updatedCache).not.toBeNull();
    expect(updatedCache?.recommendations).toHaveLength(1);
    expect(updatedCache?.recommendations[0].movie.id).toBe(2);
    expect(updatedCache?.recommendations[0].rank).toBe(1);
    expect(updatedCache?.generatedAt).toBe(1000);
    expect(updatedCache?.usedProvider).toBe('gemini');
    expect(updatedCache?.settingsFingerprint).toBe('fp-initial');
    expect(updatedCache?.ratedCount).toBe(5);

    unmount();

    const { result: remountResult } = renderHook(() => useMovieStore(), { wrapper: strictWrapper });
    expect(remountResult.current.recommendations).toHaveLength(1);
    expect(remountResult.current.recommendations[0].movie.id).toBe(2);
    expect(remountResult.current.cachedRecsTimestamp).toBe(1000);
    expect(remountResult.current.lastProviderUsed).toBe('gemini');
    expect(remountResult.current.lastRunFingerprint).toBe('fp-initial');
    expect(remountResult.current.lastRunRatedCount).toBe(5);
  });

  it('hide with a cache that doesn\'t contain the film but memory does: it\'s still persisted', () => {
    const movie3 = makeMovie(3, 'Film 3');
    const rec3 = makeRec(movie3, 3, 80);

    writeRecommendationCache({
      recommendations: [rec1, rec3],
      generatedAt: 1000,
      usedProvider: 'gemini',
      settingsFingerprint: 'fp-initial',
      ratedCount: 5,
    });

    const { result, unmount } = renderHook(() => useMovieStore(), { wrapper: strictWrapper });
    expect(result.current.recommendations).toHaveLength(2);

    // Overwrite storage cache so it only contains rec2 (rec1 is missing from cache, and rec3 is missing from cache; memory has rec1 and rec3)
    writeRecommendationCache({
      recommendations: [rec2],
      generatedAt: 1000,
      usedProvider: 'gemini',
      settingsFingerprint: 'fp-initial',
      ratedCount: 5,
    });

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    act(() => {
      result.current.hideFilm(1, 'seen', 'Film 1');
    });

    const cacheWrites = setItemSpy.mock.calls.filter(
      ([key]) => key === STORAGE_KEYS.CACHED_RECOMMENDATIONS
    );
    expect(cacheWrites).toHaveLength(1);

    // In memory, film 1 is gone, rec3 remains with rank 1
    expect(result.current.recommendations).toHaveLength(1);
    expect(result.current.recommendations[0].movie.id).toBe(3);
    expect(result.current.recommendations[0].rank).toBe(1);

    // Cache must have been overwritten with memory's next ([rec3]), replacing [rec2]
    const updatedCache = readRecommendationCache();
    expect(updatedCache?.recommendations).toHaveLength(1);
    expect(updatedCache?.recommendations[0].movie.id).toBe(3);
    expect(updatedCache?.recommendations[0].rank).toBe(1);

    unmount();

    // On remount, rec3 is hydrated from the persisted cache
    const { result: remountResult } = renderHook(() => useMovieStore(), { wrapper: strictWrapper });
    expect(remountResult.current.recommendations).toHaveLength(1);
    expect(remountResult.current.recommendations[0].movie.id).toBe(3);
  });

  it('two dismissRecommendation calls in the same act: both are persisted', () => {
    const movie3 = makeMovie(3, 'Film 3');
    const rec3 = makeRec(movie3, 3, 80);

    writeRecommendationCache({
      recommendations: [rec1, rec2, rec3],
      generatedAt: 1000,
      usedProvider: 'gemini',
      settingsFingerprint: 'fp-initial',
      ratedCount: 5,
    });

    const { result, unmount } = renderHook(() => useMovieStore(), { wrapper: strictWrapper });
    expect(result.current.recommendations).toHaveLength(3);

    act(() => {
      result.current.dismissRecommendation(1);
      result.current.dismissRecommendation(2);
    });

    expect(result.current.recommendations).toHaveLength(1);
    expect(result.current.recommendations[0].movie.id).toBe(3);
    expect(result.current.recommendations[0].rank).toBe(1);

    const updatedCache = readRecommendationCache();
    expect(updatedCache?.recommendations).toHaveLength(1);
    expect(updatedCache?.recommendations[0].movie.id).toBe(3);
    expect(updatedCache?.recommendations[0].rank).toBe(1);

    unmount();

    const { result: remountResult } = renderHook(() => useMovieStore(), { wrapper: strictWrapper });
    expect(remountResult.current.recommendations).toHaveLength(1);
    expect(remountResult.current.recommendations[0].movie.id).toBe(3);
  });

  it('restoreFilm doesn\'t touch the recommendation cache', () => {
    writeRecommendationCache({
      recommendations: [rec1, rec2],
      generatedAt: 1000,
      usedProvider: 'gemini',
      settingsFingerprint: 'fp-initial',
      ratedCount: 5,
    });

    const { result } = renderHook(() => useMovieStore(), { wrapper: strictWrapper });

    act(() => {
      result.current.hideFilm(999, 'not_for_me', 'Some Other Film');
    });
    expect(result.current.hiddenFilms).toHaveLength(1);

    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    act(() => {
      result.current.restoreFilm(999);
    });

    expect(result.current.hiddenFilms).toHaveLength(0);

    const recCacheWrites = setItemSpy.mock.calls.filter(
      ([key]) => key === STORAGE_KEYS.CACHED_RECOMMENDATIONS
    );
    expect(recCacheWrites).toHaveLength(0);

    const currentCache = readRecommendationCache();
    expect(currentCache?.recommendations).toHaveLength(2);
  });

  it('hydration from a cache without settingsFingerprint still hydrates the list', () => {
    safeSetItem(
      STORAGE_KEYS.CACHED_RECOMMENDATIONS,
      JSON.stringify({
        recommendations: [rec1, rec2],
        generatedAt: 2000,
        usedProvider: 'openrouter',
      })
    );

    const { result, unmount } = renderHook(() => useMovieStore(), { wrapper: strictWrapper });

    expect(result.current.recommendations).toHaveLength(2);
    expect(result.current.recommendations[0].movie.id).toBe(1);
    expect(result.current.recommendations[1].movie.id).toBe(2);
    expect(result.current.cachedRecsTimestamp).toBe(2000);
    expect(result.current.lastProviderUsed).toBe('openrouter');
    expect(result.current.lastRunFingerprint).toBeNull();

    // Dismissing recommendation when settingsFingerprint is missing still writes a valid cache
    act(() => {
      result.current.dismissRecommendation(1);
    });

    expect(result.current.recommendations).toHaveLength(1);
    expect(result.current.recommendations[0].movie.id).toBe(2);

    const updatedCache = readRecommendationCache();
    expect(updatedCache).not.toBeNull();
    expect(updatedCache?.recommendations).toHaveLength(1);
    expect(updatedCache?.recommendations[0].movie.id).toBe(2);
    expect(updatedCache?.generatedAt).toBe(2000);
    expect(updatedCache?.usedProvider).toBe('openrouter');
    expect(updatedCache?.settingsFingerprint).toBeUndefined();

    unmount();

    const { result: remountResult } = renderHook(() => useMovieStore(), { wrapper: strictWrapper });
    expect(remountResult.current.recommendations).toHaveLength(1);
    expect(remountResult.current.recommendations[0].movie.id).toBe(2);
  });

  it('hide with no cache, then remount: the hidden film stays gone and memory is persisted to cache', () => {
    writeRecommendationCache({
      recommendations: [rec1, rec2],
      generatedAt: 1000,
      usedProvider: 'gemini',
      settingsFingerprint: 'fp-initial',
      ratedCount: 5,
    });

    const { result, unmount } = renderHook(() => useMovieStore(), { wrapper: strictWrapper });
    expect(result.current.recommendations).toHaveLength(2);

    safeRemoveItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS);
    expect(readRecommendationCache()).toBeNull();

    act(() => {
      result.current.hideFilm(1, 'seen', 'Film 1');
    });

    expect(result.current.recommendations).toHaveLength(1);
    expect(result.current.recommendations[0].movie.id).toBe(2);
    expect(result.current.hiddenFilms).toHaveLength(1);

    const updatedCache = readRecommendationCache();
    expect(updatedCache).not.toBeNull();
    expect(updatedCache?.recommendations).toHaveLength(1);
    expect(updatedCache?.recommendations[0].movie.id).toBe(2);
    expect(updatedCache?.generatedAt).toBe(1000);
    expect(updatedCache?.usedProvider).toBe('gemini');
    expect(updatedCache?.settingsFingerprint).toBe('fp-initial');
    expect(updatedCache?.ratedCount).toBe(5);

    unmount();

    const { result: remountResult } = renderHook(() => useMovieStore(), { wrapper: strictWrapper });
    expect(remountResult.current.recommendations).toHaveLength(1);
    expect(remountResult.current.recommendations[0].movie.id).toBe(2);
    expect(remountResult.current.hiddenFilms).toHaveLength(1);
  });

  it('dismiss the single/last recommendation: empty list is persisted to cache and remains empty on remount', () => {
    writeRecommendationCache({
      recommendations: [rec1],
      generatedAt: 1000,
      usedProvider: 'gemini',
      settingsFingerprint: 'fp-initial',
      ratedCount: 5,
    });

    const { result, unmount } = renderHook(() => useMovieStore(), { wrapper: strictWrapper });
    expect(result.current.recommendations).toHaveLength(1);

    act(() => {
      result.current.dismissRecommendation(1);
    });

    expect(result.current.recommendations).toHaveLength(0);

    const updatedCache = readRecommendationCache();
    expect(updatedCache).not.toBeNull();
    expect(updatedCache?.recommendations).toHaveLength(0);
    expect(updatedCache?.generatedAt).toBe(1000);
    expect(updatedCache?.usedProvider).toBe('gemini');

    unmount();

    const { result: remountResult } = renderHook(() => useMovieStore(), { wrapper: strictWrapper });
    expect(remountResult.current.recommendations).toHaveLength(0);
  });

  it('invalid cache with non-finite or NaN numeric fields is rejected and replaced on dismiss', () => {
    safeSetItem(
      STORAGE_KEYS.CACHED_RECOMMENDATIONS,
      JSON.stringify({
        recommendations: [rec1, rec2],
        generatedAt: 'not-a-number',
        usedProvider: 'gemini',
        ratedCount: 'five',
      })
    );

    // Non-numeric generatedAt drops the cache entirely
    expect(readRecommendationCache()).toBeNull();

    const { result, unmount } = renderHook(() => useMovieStore(), { wrapper: strictWrapper });
    expect(result.current.recommendations).toHaveLength(0);

    // Movie with non-numeric id is rejected by cache validation
    safeSetItem(
      STORAGE_KEYS.CACHED_RECOMMENDATIONS,
      JSON.stringify({
        recommendations: [{ movie: { id: 'invalid-id' }, score: 90, rank: 1, reason: '' }],
        generatedAt: 1000,
        usedProvider: 'gemini',
      })
    );
    expect(readRecommendationCache()).toBeNull();
    unmount();
  });

  it('cache with missing required fields (usedProvider or recommendations) is dropped entirely', () => {
    // Missing usedProvider
    safeSetItem(
      STORAGE_KEYS.CACHED_RECOMMENDATIONS,
      JSON.stringify({
        recommendations: [rec1, rec2],
        generatedAt: 1000,
      })
    );
    expect(readRecommendationCache()).toBeNull();

    // Missing recommendations
    safeSetItem(
      STORAGE_KEYS.CACHED_RECOMMENDATIONS,
      JSON.stringify({
        generatedAt: 1000,
        usedProvider: 'gemini',
      })
    );
    expect(readRecommendationCache()).toBeNull();

    // Non-array recommendations
    safeSetItem(
      STORAGE_KEYS.CACHED_RECOMMENDATIONS,
      JSON.stringify({
        recommendations: 'not-an-array',
        generatedAt: 1000,
        usedProvider: 'gemini',
      })
    );
    expect(readRecommendationCache()).toBeNull();
  });
});
