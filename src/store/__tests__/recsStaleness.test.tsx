import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MovieStoreProvider, useMovieStore } from '../useMovieStore';
import { Recommendation, Movie } from '../../types';
import { STORAGE_KEYS, clearInMemoryStoreForTesting, safeGetItem, safeSetItem } from '../../services/storage';
import { recsSettingsFingerprint } from '../../services/recommendation/settingsFingerprint';
import { aiManager } from '../../services/ai/aiManager';
import { credentialCoordinator } from '../../services/credentialCoordinator';

vi.mock('../../services/tmdb', () => ({
  IMAGE_BASE_URL: 'https://image.tmdb.org/t/p/w500',
  getMovieDetails: vi.fn().mockResolvedValue(null),
  hydrateBatchWithDiscoveries: vi.fn().mockResolvedValue([]),
  getEraDateRange: vi.fn().mockReturnValue(null),
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

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MovieStoreProvider>{children}</MovieStoreProvider>
);

const makeMovie = (id: number): Movie => ({
  id,
  title: `Movie ${id}`,
  overview: '',
  release_date: '2020-01-01',
  vote_average: 8.0,
  vote_count: 100,
  poster_path: null,
  backdrop_path: null,
  genres: [],
});

const makeRec = (id: number, score: number): Recommendation => ({
  movie: makeMovie(id),
  score,
  rank: 0,
  reason: 'Recommended',
  serendipityType: 'safe_bet',
  highlightTags: [],
});

describe('Recommendation Staleness and Store Lifecycle (CIN-43)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    vi.clearAllMocks();
  });

  it('generatedAt is kept on dismissRecommendation', () => {
    const initialGeneratedAt = 1600000000000;
    const cachedData = {
      recommendations: [
        makeRec(101, 90),
        makeRec(102, 85),
      ],
      generatedAt: initialGeneratedAt,
      usedProvider: 'gemini',
      settingsFingerprint: 'test-fp',
      ratedCount: 5,
    };
    safeSetItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedData));

    const { result } = renderHook(() => useMovieStore(), { wrapper });

    expect(result.current.recommendations).toHaveLength(2);
    expect(result.current.cachedRecsTimestamp).toBe(initialGeneratedAt);

    act(() => {
      result.current.dismissRecommendation(101);
    });

    expect(result.current.recommendations).toHaveLength(1);
    expect(result.current.recommendations[0].movie.id).toBe(102);
    expect(result.current.cachedRecsTimestamp).toBe(initialGeneratedAt);

    const storedStr = safeGetItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS);
    expect(storedStr).not.toBeNull();
    const stored = JSON.parse(storedStr!);
    expect(stored.generatedAt).toBe(initialGeneratedAt);
    expect(stored.recommendations).toHaveLength(1);
    expect(stored.recommendations[0].movie.id).toBe(102);
  });

  it('a failed generation (mocked provider error) leaves recsSettingsStale and lastRunRatedCount unchanged', async () => {
    const fingerprint = recsSettingsFingerprint({
      activeProvider: 'gemini',
      serendipityLevel: 40,
      preferredEras: [],
      selectedVibes: [],
    });

    const cachedData = {
      recommendations: [makeRec(1, 90)],
      generatedAt: 100000,
      usedProvider: 'gemini',
      settingsFingerprint: fingerprint,
      ratedCount: 7,
    };
    safeSetItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedData));

    const { result } = renderHook(() => useMovieStore(), { wrapper });

    // Initially not stale, and lastRunRatedCount is 7
    expect(result.current.recsSettingsStale).toBe(false);
    expect(result.current.lastRunRatedCount).toBe(7);

    // Update settings to make recs stale
    act(() => {
      result.current.updateAISettings({ serendipityLevel: 80 });
    });

    expect(result.current.recsSettingsStale).toBe(true);
    expect(result.current.lastRunRatedCount).toBe(7);

    // Mock failure during generateRankings
    vi.mocked(aiManager.generateRecommendations).mockRejectedValueOnce(
      new Error('Provider rate limit reached')
    );

    await act(async () => {
      await result.current.generateRankings();
    });

    // Error is captured, but recsSettingsStale and lastRunRatedCount remain unchanged
    expect(result.current.recommendationError).toBe('Provider rate limit reached');
    expect(result.current.recsSettingsStale).toBe(true);
    expect(result.current.lastRunRatedCount).toBe(7);
  });

  it('clearAllData resets lastRunRatedCount to null and recsSettingsStale to false', () => {
    // The real coordinator touches the native vault; this test is about store state only.
    vi.spyOn(credentialCoordinator, 'clearAllData').mockResolvedValue(undefined);
    const fingerprint = recsSettingsFingerprint({
      activeProvider: 'gemini',
      serendipityLevel: 40,
      preferredEras: [],
      selectedVibes: [],
    });

    const cachedData = {
      recommendations: [makeRec(1, 90)],
      generatedAt: 100000,
      usedProvider: 'gemini',
      settingsFingerprint: fingerprint,
      ratedCount: 5,
    };
    safeSetItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedData));

    const { result } = renderHook(() => useMovieStore(), { wrapper });

    // Make settings stale
    act(() => {
      result.current.updateAISettings({ serendipityLevel: 90 });
    });
    expect(result.current.recsSettingsStale).toBe(true);
    expect(result.current.lastRunRatedCount).toBe(5);

    // Clear all data
    act(() => {
      result.current.clearAllData();
    });

    expect(result.current.lastRunRatedCount).toBeNull();
    expect(result.current.recsSettingsStale).toBe(false);
    expect(result.current.recommendations).toEqual([]);
    expect(result.current.cachedRecsTimestamp).toBeNull();
    expect(safeGetItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS)).toBeNull();
  });

  it('changing activeProvider flips recsSettingsStale to true', () => {
    const fingerprint = recsSettingsFingerprint({
      activeProvider: 'gemini',
      serendipityLevel: 40,
      preferredEras: [],
      selectedVibes: [],
    });

    const cachedData = {
      recommendations: [makeRec(1, 90)],
      generatedAt: 100000,
      usedProvider: 'gemini',
      settingsFingerprint: fingerprint,
      ratedCount: 5,
    };
    safeSetItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedData));

    const { result } = renderHook(() => useMovieStore(), { wrapper });

    expect(result.current.recsSettingsStale).toBe(false);

    // Switch activeProvider from gemini to openrouter
    act(() => {
      result.current.updateAISettings({ activeProvider: 'openrouter' });
    });

    expect(result.current.recsSettingsStale).toBe(true);

    // Switch back to gemini
    act(() => {
      result.current.updateAISettings({ activeProvider: 'gemini' });
    });

    expect(result.current.recsSettingsStale).toBe(false);
  });
});
