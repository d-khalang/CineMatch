import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { DiscoveryFilters } from '../DiscoveryFilters';
import { MovieStoreProvider, useMovieStore } from '../../store/useMovieStore';
import { STORAGE_KEYS, clearInMemoryStoreForTesting } from '../../services/storage';
import { recsSettingsFingerprint } from '../../services/recommendation/settingsFingerprint';
import { Movie } from '../../types';
import { aiManager } from '../../services/ai/aiManager';

vi.mock('../../services/tmdb', () => ({
  IMAGE_BASE_URL: 'https://image.tmdb.org/t/p/w500',
  getMovieDetails: vi.fn().mockResolvedValue(null),
  hydrateBatchWithDiscoveries: vi.fn().mockResolvedValue([]),
  getEraDateRange: vi.fn().mockReturnValue(null),
}));

vi.mock('../../services/credentialStore', () => ({
  credentialStore: {
    hasTmdb: vi.fn().mockReturnValue(true),
    getCredentials: vi.fn().mockReturnValue({ tmdbApiKey: 'test-key' }),
    getVersion: vi.fn().mockReturnValue(1),
    subscribe: vi.fn().mockReturnValue(() => {}),
  },
}));

vi.mock('../../services/recommendation/candidateSources', () => ({
  getCandidateRecommendationPool: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../services/ai/aiManager', () => ({
  aiManager: {
    generateRecommendations: vi.fn().mockResolvedValue({
      recommendations: [],
      usedProvider: 'gemini',
    }),
  },
}));

// Helper component that allows driving store actions
const TestController: React.FC<{ onStoreReady?: (store: ReturnType<typeof useMovieStore>) => void }> = ({
  onStoreReady,
}) => {
  const store = useMovieStore();
  React.useEffect(() => {
    onStoreReady?.(store);
  }, [store, onStoreReady]);
  return <DiscoveryFilters />;
};

describe('DiscoveryFilters "Settings changed" state (CIN-40)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    vi.clearAllMocks();
  });

  it('shows "Settings changed — re-rank to apply" with role="status" only when recsSettingsStale is true', () => {
    const fingerprint = recsSettingsFingerprint({
      activeProvider: 'gemini',
      serendipityLevel: 40,
      preferredEras: [],
      selectedVibes: [],
    });

    const cachedData = {
      recommendations: [
        {
          movie: {
            id: 1,
            title: 'Existing Film',
            overview: '',
            release_date: '2020-01-01',
            vote_average: 8.0,
            vote_count: 100,
            poster_path: null,
            backdrop_path: null,
            genres: [],
          } as Movie,
          score: 90,
          rank: 1,
          reason: 'Match',
          serendipityType: 'safe_bet',
          highlightTags: [],
        },
      ],
      generatedAt: 100000,
      usedProvider: 'gemini',
      settingsFingerprint: fingerprint,
      ratedCount: 5,
    };
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedData));

    let storeRef: ReturnType<typeof useMovieStore>;
    const { rerender } = render(
      <MovieStoreProvider>
        <TestController onStoreReady={(store) => (storeRef = store)} />
      </MovieStoreProvider>
    );

    // Initial state: status region exists and is empty
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.queryByText(/Settings changed — re-rank to apply/i)).toBeNull();

    // Change serendipity setting
    act(() => {
      storeRef.updateAISettings({ serendipityLevel: 80 });
    });

    rerender(
      <MovieStoreProvider>
        <TestController />
      </MovieStoreProvider>
    );

    // Stale state: label must appear with role="status"
    const statusLabel = screen.getByRole('status');
    expect(statusLabel).toBeDefined();
    expect(statusLabel.textContent).toBe('Settings changed — re-rank to apply');

    // Change setting back to original
    act(() => {
      storeRef.updateAISettings({ serendipityLevel: 40 });
    });

    rerender(
      <MovieStoreProvider>
        <TestController />
      </MovieStoreProvider>
    );

    // Not stale anymore: status region is empty
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.queryByText(/Settings changed — re-rank to apply/i)).toBeNull();
  });

  it('does not show the status label when isGeneratingRecs is true even if settings differ', async () => {
    let resolveRecs: (value: unknown) => void = () => {};
    const pendingPromise = new Promise((resolve) => {
      resolveRecs = resolve;
    });
    vi.mocked(aiManager.generateRecommendations).mockReturnValueOnce(pendingPromise as any);

    const fingerprint = recsSettingsFingerprint({
      activeProvider: 'gemini',
      serendipityLevel: 40,
      preferredEras: [],
      selectedVibes: [],
    });

    const cachedData = {
      recommendations: [
        {
          movie: {
            id: 1,
            title: 'Existing Film',
            overview: '',
            release_date: '2020-01-01',
            vote_average: 8.0,
            vote_count: 100,
            poster_path: null,
            backdrop_path: null,
            genres: [],
          } as Movie,
          score: 90,
          rank: 1,
          reason: 'Match',
          serendipityType: 'safe_bet',
          highlightTags: [],
        },
      ],
      generatedAt: 100000,
      usedProvider: 'gemini',
      settingsFingerprint: fingerprint,
      ratedCount: 5,
    };
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedData));

    let storeRef: ReturnType<typeof useMovieStore>;
    const { rerender } = render(
      <MovieStoreProvider>
        <TestController onStoreReady={(store) => (storeRef = store)} />
      </MovieStoreProvider>
    );

    // Make stale
    act(() => {
      storeRef.updateAISettings({ serendipityLevel: 80 });
    });

    rerender(
      <MovieStoreProvider>
        <TestController />
      </MovieStoreProvider>
    );

    expect(screen.getByRole('status').textContent).toBe('Settings changed — re-rank to apply');

    // Start generation (in-flight)
    act(() => {
      storeRef.generateRankings();
    });

    rerender(
      <MovieStoreProvider>
        <TestController />
      </MovieStoreProvider>
    );

    // While generating, status label text is empty
    expect(screen.getByRole('status').textContent).toBe('');
    expect(screen.queryByText(/Settings changed — re-rank to apply/i)).toBeNull();

    // Clean up pending promise
    await act(async () => {
      resolveRecs({
        recommendations: [],
        usedProvider: 'gemini',
      });
    });
  });
});
