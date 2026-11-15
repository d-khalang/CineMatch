import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MovieStoreProvider, useMovieStore } from '../useMovieStore';
import { STORAGE_KEYS, clearInMemoryStoreForTesting } from '../../services/storage';
import { aiManager } from '../../services/ai/aiManager';
import { LocalProvider } from '../../services/ai/localProvider';
import { getCandidateRecommendationPool } from '../../services/recommendation/candidateSources';
import type { Movie } from '../../types';

const mockPool: Movie[] = [
  {
    id: 501,
    title: 'Seed Gem Movie',
    overview: 'A thrilling mystery.',
    release_date: '2021-05-01',
    vote_average: 8.1,
    vote_count: 600,
    poster_path: '/p501.jpg',
    backdrop_path: null,
    genres: [{ id: 18, name: 'Drama' }],
    candidateSources: ['seed_graph', 'hidden_gem'],
    seedNeighbour: true,
  },
  {
    id: 502,
    title: 'Acclaimed Classic',
    overview: 'An acclaimed drama.',
    release_date: '1999-10-15',
    vote_average: 8.4,
    vote_count: 5000,
    poster_path: '/p502.jpg',
    backdrop_path: null,
    genres: [{ id: 80, name: 'Crime' }],
    candidateSources: ['acclaimed_baseline'],
    seedNeighbour: false,
  },
];

vi.mock('../../services/tmdb', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    IMAGE_BASE_URL: 'https://image.tmdb.org/t/p/w500',
    getMovieDetails: vi.fn().mockResolvedValue(null),
    hydrateBatchWithDiscoveries: vi.fn().mockResolvedValue([]),
  };
});

vi.mock('../../services/recommendation/candidateSources', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getCandidateRecommendationPool: vi.fn().mockImplementation(async () => mockPool),
  };
});

vi.mock('../../services/credentialStore', () => ({
  credentialStore: {
    hasTmdb: vi.fn().mockReturnValue(true),
    getCredentials: vi.fn().mockReturnValue({ tmdbApiKey: 'test-tmdb-key' }),
    getVersion: vi.fn().mockReturnValue(1),
    subscribe: vi.fn().mockReturnValue(() => {}),
    forgetAll: vi.fn(),
    clearAllData: vi.fn(),
  },
}));

vi.mock('../../services/ai/aiManager', () => ({
  aiManager: {
    generateRecommendations: vi.fn().mockResolvedValue({
      recommendations: [],
      usedProvider: 'local',
    }),
  },
}));

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MovieStoreProvider>{children}</MovieStoreProvider>
);

describe('MovieStore generateRankings candidate wiring (CIN-9)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    vi.clearAllMocks();
  });

  it('passes candidates whose sources come from the pool movies candidateSources', async () => {
    localStorage.setItem(
      STORAGE_KEYS.RATINGS,
      JSON.stringify({
        101: {
          movieId: 101,
          title: 'Rated Film One',
          rating: 9,
          posterPath: null,
          genres: ['Drama'],
          ratedAt: 1000,
        },
        102: {
          movieId: 102,
          title: 'Rated Film Two',
          rating: 8,
          posterPath: null,
          genres: ['Crime'],
          ratedAt: 2000,
        },
      })
    );

    const { result } = renderHook(() => useMovieStore(), { wrapper });

    await act(async () => {
      await result.current.generateRankings();
    });

    expect(aiManager.generateRecommendations).toHaveBeenCalledTimes(1);
    const [, request] = vi.mocked(aiManager.generateRecommendations).mock.calls[0];

    expect(request.candidates).toBeDefined();
    expect(request.candidates).toHaveLength(2);
    expect(request.candidates![0].movie.id).toBe(501);
    expect(request.candidates![0].sources).toEqual(['seed_graph', 'hidden_gem']);
    expect(request.candidates![0].seedNeighbour).toBe(true);
    expect(request.candidates![1].movie.id).toBe(502);
    expect(request.candidates![1].sources).toEqual(['acclaimed_baseline']);
    expect(request.candidates![1].seedNeighbour).toBe(false);
  });

  it('preserves bucket-interleaved top-5 ordering and bucket metadata when LocalProvider ranks candidates', async () => {
    localStorage.setItem(
      STORAGE_KEYS.RATINGS,
      JSON.stringify({
        101: {
          movieId: 101,
          title: 'Rated Drama',
          rating: 10,
          posterPath: null,
          year: '2015',
          genres: ['Drama', 'Crime'],
          director: 'Fav Director',
          ratedAt: 1000,
        },
        102: {
          movieId: 102,
          title: 'Rated Crime',
          rating: 9,
          posterPath: null,
          year: '2016',
          genres: ['Crime'],
          director: 'Fav Director',
          ratedAt: 2000,
        },
      })
    );
    localStorage.setItem(
      STORAGE_KEYS.SETTINGS,
      JSON.stringify({
        activeProvider: 'local',
        serendipityLevel: 60,
      })
    );

    const mixedPool: Movie[] = [
      ...Array.from({ length: 6 }, (_, i) => ({
        id: 600 + i,
        title: `Safe_Match_${i}`,
        overview: 'Crime drama',
        release_date: '2015-05-01',
        vote_average: 8.2,
        vote_count: 25000 - i * 1000,
        poster_path: `/s${i}.jpg`,
        backdrop_path: null,
        director: i === 0 ? 'Fav Director' : `Safe Dir ${i}`,
        genres: [{ id: 18, name: 'Drama' }, { id: 80, name: 'Crime' }],
        candidateSources: ['seed_graph'] as Movie['candidateSources'],
        seedNeighbour: true,
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        id: 700 + i,
        title: `Stretch_Match_${i}`,
        overview: 'Sci-fi drama',
        release_date: '1985-05-01',
        vote_average: 8.0,
        vote_count: 800 - i * 50,
        poster_path: `/st${i}.jpg`,
        backdrop_path: null,
        director: `Creator Dir ${i}`,
        genres: [{ id: 18, name: 'Drama' }, { id: 878, name: 'Science Fiction' }],
        candidateSources: ['creator_graph'] as Movie['candidateSources'],
        seedNeighbour: false,
      })),
      ...Array.from({ length: 2 }, (_, i) => ({
        id: 800 + i,
        title: `Wildcard_Match_${i}`,
        overview: 'Classic western',
        release_date: '1968-05-01',
        vote_average: 7.9,
        vote_count: 200 - i * 20,
        poster_path: `/w${i}.jpg`,
        backdrop_path: null,
        director: `Wild Dir ${i}`,
        genres: [{ id: 37, name: 'Western' }],
        candidateSources: ['hidden_gem'] as Movie['candidateSources'],
        seedNeighbour: false,
      })),
    ];

    vi.mocked(getCandidateRecommendationPool).mockResolvedValueOnce(mixedPool);
    vi.mocked(aiManager.generateRecommendations).mockImplementationOnce(
      async (_providerId, req, signal) => {
        const res = await new LocalProvider().generateRecommendations(req, signal);
        return {
          ...res,
          usedProvider: 'Local Smart Heuristic (Zero Config)',
        };
      }
    );

    const { result } = renderHook(() => useMovieStore(), { wrapper });

    await act(async () => {
      await result.current.generateRankings();
    });

    const recs = result.current.recommendations;
    expect(recs).toHaveLength(12);
    expect(recs.every((r) => r.bucket !== undefined && Array.isArray(r.sources))).toBe(true);
    expect(recs.map((r) => r.rank)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));

    const top5Buckets = recs.slice(0, 5).map((r) => r.bucket);
    expect(top5Buckets).toContain('safe_bet');
    expect(top5Buckets).toContain('stretch');
    expect(top5Buckets).toContain('wildcard');
  });
});
