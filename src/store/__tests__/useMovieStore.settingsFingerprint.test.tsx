import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MovieStoreProvider, useMovieStore } from '../useMovieStore';
import { Movie, Recommendation } from '../../types';
import { STORAGE_KEYS, clearInMemoryStoreForTesting } from '../../services/storage';
import { recsSettingsFingerprint } from '../../services/recommendation/settingsFingerprint';

vi.mock('../../services/credentialStore', () => ({
  credentialStore: {
    hasTmdb: vi.fn().mockReturnValue(true),
    getCredentials: vi.fn().mockReturnValue({ tmdbApiKey: 'test-key', geminiApiKey: 'test-gemini' }),
    getVersion: vi.fn().mockReturnValue(1),
    subscribe: vi.fn().mockReturnValue(() => {}),
  },
  credentialCoordinator: {
    clearAllData: vi.fn(),
  },
}));

vi.mock('../../services/recommendation/candidateSources', () => ({
  getCandidateRecommendationPool: vi.fn().mockResolvedValue([
    {
      id: 501,
      title: 'Candidate Film',
      overview: 'Overview',
      release_date: '2020-01-01',
      vote_average: 8.0,
      vote_count: 100,
      poster_path: null,
      backdrop_path: null,
      genres: [{ id: 18, name: 'Drama' }],
    },
  ]),
}));

vi.mock('../../services/tmdb', () => ({
  getMovieDetails: vi.fn().mockResolvedValue(null),
  hydrateBatchWithDiscoveries: vi.fn().mockResolvedValue([]),
  getEraDateRange: vi.fn().mockReturnValue(null),
}));

vi.mock('../../services/ai/aiManager', () => ({
  aiManager: {
    generateRecommendations: vi.fn().mockResolvedValue({
      recommendations: [
        {
          movie: {
            id: 501,
            title: 'Candidate Film',
            overview: 'Overview',
            release_date: '2020-01-01',
            vote_average: 8.0,
            vote_count: 100,
            poster_path: null,
            backdrop_path: null,
            genres: [{ id: 18, name: 'Drama' }],
          },
          score: 95,
          rank: 1,
          reason: 'Matches taste profile',
          serendipityType: 'safe_bet',
          highlightTags: ['Drama'],
        },
      ],
      usedProvider: 'gemini',
    }),
  },
}));

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MovieStoreProvider>{children}</MovieStoreProvider>
);

describe('MovieStore Settings Fingerprint & Staleness (CIN-40)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    vi.clearAllMocks();
  });

  // Acceptance Criterion 2
  it('after generation (mocked provider), changing serendipityLevel makes recsSettingsStale true; changing it back makes it false', async () => {
    const { result } = renderHook(() => useMovieStore(), { wrapper });

    // Rate a movie so generation has a seed
    await act(async () => {
      await result.current.setRating(
        {
          id: 10,
          title: 'Inception',
          overview: 'Dreams',
          release_date: '2010-07-16',
          vote_average: 8.8,
          vote_count: 30000,
          poster_path: null,
          backdrop_path: null,
          genres: [{ id: 878, name: 'Sci-Fi' }],
        },
        9
      );
    });

    // Run recommendation generation
    await act(async () => {
      await result.current.generateRankings();
    });

    expect(result.current.recommendations.length).toBe(1);
    expect(result.current.lastRunRatedCount).toBe(1);
    expect(result.current.recsSettingsStale).toBe(false);

    // Changing serendipityLevel should mark recommendations stale
    act(() => {
      result.current.updateAISettings({ serendipityLevel: 85 });
    });
    expect(result.current.recsSettingsStale).toBe(true);

    // Changing it back to original 40 should make it not stale
    act(() => {
      result.current.updateAISettings({ serendipityLevel: 40 });
    });
    expect(result.current.recsSettingsStale).toBe(false);
  });

  // Acceptance Criterion 3
  it('dismissRecommendation and hideFilm keep settingsFingerprint and ratedCount in the cached JSON', async () => {
    const initialRecs: Recommendation[] = [
      {
        movie: {
          id: 101,
          title: 'Film 101',
          overview: '',
          release_date: '2020-01-01',
          vote_average: 8.0,
          vote_count: 100,
          poster_path: null,
          backdrop_path: null,
          genres: [],
        },
        score: 90,
        rank: 1,
        reason: 'Good',
        serendipityType: 'safe_bet',
        highlightTags: [],
      },
      {
        movie: {
          id: 202,
          title: 'Film 202',
          overview: '',
          release_date: '2021-01-01',
          vote_average: 8.5,
          vote_count: 200,
          poster_path: null,
          backdrop_path: null,
          genres: [],
        },
        score: 80,
        rank: 2,
        reason: 'Great',
        serendipityType: 'thematic_gem',
        highlightTags: [],
      },
    ];

    const initialFingerprint = recsSettingsFingerprint({
      activeProvider: 'gemini',
      serendipityLevel: 40,
      preferredEras: [],
      selectedVibes: [],
    });

    const cachedData = {
      recommendations: initialRecs,
      generatedAt: 1234567,
      usedProvider: 'gemini',
      tasteAnalysis: 'Analyzed DNA',
      settingsFingerprint: initialFingerprint,
      ratedCount: 7,
    };
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedData));

    const { result } = renderHook(() => useMovieStore(), { wrapper });
    expect(result.current.recommendations.length).toBe(2);
    expect(result.current.lastRunRatedCount).toBe(7);

    // Call dismissRecommendation on first film
    act(() => {
      result.current.dismissRecommendation(101);
    });
    expect(result.current.recommendations.length).toBe(1);

    const afterDismissRaw = localStorage.getItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS);
    expect(afterDismissRaw).toBeDefined();
    const afterDismiss = JSON.parse(afterDismissRaw!);
    expect(afterDismiss.settingsFingerprint).toBe(initialFingerprint);
    expect(afterDismiss.ratedCount).toBe(7);

    // Call hideFilm on second film
    act(() => {
      result.current.hideFilm(202, 'seen', 'Film 202');
    });
    expect(result.current.recommendations.length).toBe(0);

    const afterHideRaw = localStorage.getItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS);
    expect(afterHideRaw).toBeDefined();
    const afterHide = JSON.parse(afterHideRaw!);
    expect(afterHide.settingsFingerprint).toBe(initialFingerprint);
    expect(afterHide.ratedCount).toBe(7);
  });

  // Acceptance Criterion 4
  it('a cache without settingsFingerprint hydrates with recsSettingsStale === false', () => {
    const legacyCached = {
      recommendations: [
        {
          movie: {
            id: 303,
            title: 'Old Legacy Film',
            overview: '',
            release_date: '2019-01-01',
            vote_average: 7.5,
            vote_count: 50,
            poster_path: null,
            backdrop_path: null,
            genres: [],
          },
          score: 88,
          rank: 1,
          reason: 'Classic',
          serendipityType: 'safe_bet',
          highlightTags: [],
        },
      ],
      generatedAt: 1111111,
      usedProvider: 'gemini',
    };
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(legacyCached));

    const { result } = renderHook(() => useMovieStore(), { wrapper });
    expect(result.current.recommendations.length).toBe(1);
    expect(result.current.lastRunRatedCount).toBeNull();
    // Stored fingerprint is null, so list should NOT be marked stale
    expect(result.current.recsSettingsStale).toBe(false);

    // Even if settings are updated, since there was no stored fingerprint, it remains not stale
    act(() => {
      result.current.updateAISettings({ serendipityLevel: 90 });
    });
    expect(result.current.recsSettingsStale).toBe(false);
  });
});
