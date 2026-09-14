import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { RankedFeed } from '../RankedFeed';
import { MovieStoreProvider } from '../../store/useMovieStore';
import { STORAGE_KEYS } from '../../services/storage';
import { aiManager } from '../../services/ai/aiManager';

// Mock dependencies
vi.mock('../../services/tmdb', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    IMAGE_BASE_URL: 'https://image.tmdb.org/t/p/w500',
    getCandidateRecommendationPool: vi.fn().mockResolvedValue([
      {
        id: 500,
        title: 'Candidate Movie',
        overview: 'Good movie',
        release_date: '2022-01-01',
        vote_average: 8.0,
        vote_count: 500,
        poster_path: null,
        backdrop_path: null,
        genres: [{ id: 28, name: 'Action' }],
      },
    ]),
    getMovieDetails: vi.fn().mockResolvedValue(null),
    hydrateBatchWithDiscoveries: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../../services/credentialStore', () => ({
  credentialStore: {
    hasTmdb: vi.fn().mockReturnValue(true),
    getCredentials: vi.fn().mockReturnValue({ tmdbApiKey: 'test-tmdb-key' }),
    getVersion: vi.fn().mockReturnValue(1),
    subscribe: vi.fn().mockReturnValue(() => {}),
  },
}));

vi.mock('../../services/ai/aiManager', () => ({
  aiManager: {
    generateRecommendations: vi.fn().mockResolvedValue({
      recommendations: [],
      usedProvider: 'local',
      error: 'Simulated API failure',
    }),
  },
}));

describe('RankedFeed Auto-Generation & Infinite Retry Guard', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('does not continuously retry generateRankings when empty recommendations or error occurs', async () => {
    // Seed ratings in localStorage so store initializes with ratedCount >= 2
    const seededRatings = {
      101: {
        movieId: 101,
        title: 'Film One',
        rating: 9,
        ratedAt: 1000,
        genres: ['Action'],
      },
      202: {
        movieId: 202,
        title: 'Film Two',
        rating: 8,
        ratedAt: 2000,
        genres: ['Sci-Fi'],
      },
    };
    localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));

    render(
      <MovieStoreProvider>
        <RankedFeed />
      </MovieStoreProvider>
    );

    // Wait a brief tick for the initial auto-generation attempt
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    // The component MUST NOT loop continuously. Call count to AI provider must be exactly 1 attempt.
    expect(aiManager.generateRecommendations).toHaveBeenCalledTimes(1);

    // Verify error banner is rendered with a manual Retry button
    expect(screen.getByText(/AI Status:/)).toBeDefined();
    const retryBtn = screen.getByText('Retry Generation');
    expect(retryBtn).toBeDefined();

    // Clicking retry triggers exactly 1 additional generation
    await act(async () => {
      retryBtn.click();
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    expect(aiManager.generateRecommendations).toHaveBeenCalledTimes(2);
  });
});
