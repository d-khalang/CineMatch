import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MovieStoreProvider, useMovieStore } from '../useMovieStore';
import { credentialStore } from '../../services/credentialStore';
import { clearInMemoryStoreForTesting, STORAGE_KEYS } from '../../services/storage';
import * as candidateSources from '../../services/recommendation/candidateSources';
import * as rankCandidatesModule from '../../services/recommendation/rankCandidates';
import { aiManager } from '../../services/ai/aiManager';
import { loadOutcomeLog, saveOutcomeLog } from '../../services/recommendation/outcomeLog';
import type { Candidate, SourceCursor } from '../../services/recommendation/types';
import type { Movie, Recommendation, UserRating } from '../../types';

vi.mock('../../services/recommendation/candidateSources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/recommendation/candidateSources')>();
  return {
    ...actual,
    getCandidateRecommendationPool: vi.fn((...args: Parameters<typeof actual.getCandidateRecommendationPool>) =>
      actual.getCandidateRecommendationPool(...args)
    ),
    loadMoreCandidates: vi.fn((...args: Parameters<typeof actual.loadMoreCandidates>) =>
      actual.loadMoreCandidates(...args)
    ),
  };
});

vi.mock('../../services/recommendation/rankCandidates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/recommendation/rankCandidates')>();
  return {
    ...actual,
    rankCandidates: vi.fn((...args: Parameters<typeof actual.rankCandidates>) =>
      actual.rankCandidates(...args)
    ),
  };
});

vi.mock('../../services/ai/aiManager', () => ({
  aiManager: {
    generateRecommendations: vi.fn(),
  },
}));

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MovieStoreProvider>{children}</MovieStoreProvider>
);

function makeMovie(id: number, overrides: Partial<Movie> = {}): Movie {
  return {
    id,
    title: `Movie-${id}`,
    overview: `Overview for ${id}`,
    poster_path: `/p${id}.jpg`,
    backdrop_path: null,
    release_date: '2019-05-01',
    vote_average: 7.9,
    vote_count: 800,
    genres: [{ id: 18, name: 'Drama' }],
    director: 'Test Director',
    ...overrides,
  };
}

function makeRec(
  id: number,
  bucket: Recommendation['bucket'],
  rank: number
): Recommendation {
  return {
    movie: makeMovie(id),
    score: 90 - rank,
    rank,
    reason: 'Recommended',
    serendipityType:
      bucket === 'wildcard'
        ? 'wildcard_discovery'
        : bucket === 'stretch'
        ? 'thematic_gem'
        : 'safe_bet',
    highlightTags: ['Drama'],
    bucket,
  };
}

function seedRatings(): void {
  const ratings: Record<number, UserRating> = {
    1: {
      movieId: 1,
      title: 'Seed 1',
      rating: 10,
      posterPath: null,
      genres: ['Drama'],
      director: 'Test Director',
      ratedAt: 1000,
    },
    2: {
      movieId: 2,
      title: 'Seed 2',
      rating: 9,
      posterPath: null,
      genres: ['Drama'],
      director: 'Test Director',
      ratedAt: 2000,
    },
  };
  localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(ratings));
}

describe('useMovieStore outcome log & adaptive exploration (CIN-13)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    credentialStore.setTmdbCredential('read_access_token', 'test-token');
    vi.clearAllMocks();
  });

  it('logs shown bucketed films after generation, records rating outcomes, updates summary, and resets', async () => {
    seedRatings();

    vi.mocked(candidateSources.getCandidateRecommendationPool).mockImplementationOnce(
      async (options) => {
        options?.onCursors?.([
          { source: 'seed_graph', key: 'recommendations:1', nextPage: 2, exhausted: false },
        ]);
        return [makeMovie(101), makeMovie(102), makeMovie(103), makeMovie(104)];
      }
    );

    vi.mocked(aiManager.generateRecommendations).mockResolvedValueOnce({
      recommendations: [
        makeRec(101, 'safe_bet', 1),
        makeRec(102, 'stretch', 2),
        makeRec(103, 'wildcard', 3),
        makeRec(104, 'below_floor', 4),
      ],
      usedProvider: 'Local Smart Heuristic (Zero Config)',
    });

    const { result } = renderHook(() => useMovieStore(), { wrapper });

    expect(result.current.explorationSummary).toEqual({ hits: 0, total: 0 });

    await act(async () => {
      await result.current.generateRankings();
    });

    // Outcome log holds the shown above-floor bucketed films, skipping below_floor
    const logAfterGen = loadOutcomeLog();
    expect(logAfterGen.map((e) => ({ movieId: e.movieId, bucket: e.bucket }))).toEqual([
      { movieId: 101, bucket: 'safe_bet' },
      { movieId: 102, bucket: 'stretch' },
      { movieId: 103, bucket: 'wildcard' },
    ]);
    expect(result.current.explorationSummary).toEqual({ hits: 0, total: 0 });

    // Rate a stretch film 9 -> hit recorded, explorationSummary updates
    await act(async () => {
      await result.current.setRating(makeMovie(102), 9);
    });

    const logAfterHit = loadOutcomeLog();
    const ratedStretch = logAfterHit.find((e) => e.movieId === 102);
    expect(ratedStretch?.rating).toBe(9);
    expect(typeof ratedStretch?.ratedAt).toBe('number');
    expect(result.current.explorationSummary).toEqual({ hits: 1, total: 1 });

    // Rate a wildcard film 6 -> total increments, hits stays 1
    await act(async () => {
      await result.current.setRating(makeMovie(103), 6);
    });
    expect(result.current.explorationSummary).toEqual({ hits: 1, total: 2 });

    // Rating <= 0 removes user rating but does not record a new outcome
    await act(async () => {
      await result.current.setRating(makeMovie(102), 0);
    });
    expect(result.current.explorationSummary).toEqual({ hits: 1, total: 2 });

    // resetExploration clears storage and resets summary
    act(() => {
      result.current.resetExploration();
    });
    expect(loadOutcomeLog()).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEYS.OUTCOME_LOG)).toBeNull();
    expect(result.current.explorationSummary).toEqual({ hits: 0, total: 0 });
  });

  it('passes adaptMix using the outcome log in loadMoreRankings and logs appended items', async () => {
    seedRatings();

    // Seed 5 high-rated surprise outcomes so adaptiveMix shifts wildcard +0.05
    saveOutcomeLog([
      { movieId: 11, bucket: 'stretch', shownAt: 1000, rating: 9, ratedAt: 2000 },
      { movieId: 12, bucket: 'wildcard', shownAt: 1000, rating: 9, ratedAt: 2000 },
      { movieId: 13, bucket: 'stretch', shownAt: 1000, rating: 8, ratedAt: 2000 },
      { movieId: 14, bucket: 'wildcard', shownAt: 1000, rating: 10, ratedAt: 2000 },
      { movieId: 15, bucket: 'wildcard', shownAt: 1000, rating: 9, ratedAt: 2000 },
    ]);

    vi.mocked(candidateSources.getCandidateRecommendationPool).mockImplementationOnce(
      async (options) => {
        options?.onCursors?.([
          { source: 'seed_graph', key: 'recommendations:1', nextPage: 2, exhausted: false },
        ]);
        return [makeMovie(101)];
      }
    );

    vi.mocked(aiManager.generateRecommendations).mockResolvedValueOnce({
      recommendations: [makeRec(101, 'safe_bet', 1)],
      usedProvider: 'Local Smart Heuristic (Zero Config)',
    });

    const { result } = renderHook(() => useMovieStore(), { wrapper });
    expect(result.current.explorationSummary).toEqual({ hits: 5, total: 5 });

    await act(async () => {
      await result.current.generateRankings();
    });

    const nextCandidates: Candidate[] = [
      {
        movie: makeMovie(501, { genres: [{ id: 37, name: 'Western' }], release_date: '1969-01-01' }),
        sources: ['hidden_gem'],
        seedNeighbour: false,
      },
      {
        movie: makeMovie(502, { genres: [{ id: 18, name: 'Drama' }] }),
        sources: ['seed_graph'],
        seedNeighbour: true,
      },
    ];
    const nextCursors: SourceCursor[] = [
      { source: 'seed_graph', key: 'recommendations:1', nextPage: 3, exhausted: true },
    ];
    vi.mocked(candidateSources.loadMoreCandidates).mockResolvedValueOnce({
      candidates: nextCandidates,
      cursors: nextCursors,
    });

    await act(async () => {
      await result.current.loadMoreRankings();
    });

    expect(rankCandidatesModule.rankCandidates).toHaveBeenCalledTimes(1);
    const rankOptions = vi.mocked(rankCandidatesModule.rankCandidates).mock.calls[0][2];
    expect(typeof rankOptions.adaptMix).toBe('function');

    const adapted = rankOptions.adaptMix!({ safe_bet: 0.50, stretch: 0.35, wildcard: 0.15 });
    expect(adapted.wildcard).toBeCloseTo(0.20, 9);
    expect(adapted.safe_bet).toBeCloseTo(0.45, 9);

    const logAfterLoadMore = loadOutcomeLog();
    expect(logAfterLoadMore.some((e) => e.movieId === 501)).toBe(true);
    expect(logAfterLoadMore.some((e) => e.movieId === 502)).toBe(true);
  });

  it('does not write to the outcome log when a generation is cancelled before completing', async () => {
    seedRatings();

    vi.mocked(candidateSources.getCandidateRecommendationPool).mockImplementationOnce(
      async (options) => {
        options?.onCursors?.([
          { source: 'seed_graph', key: 'recommendations:1', nextPage: 2, exhausted: false },
        ]);
        return [makeMovie(101)];
      }
    );

    let resolveAi!: (val: { recommendations: Recommendation[]; usedProvider: string }) => void;
    vi.mocked(aiManager.generateRecommendations).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAi = resolve;
        })
    );

    const { result } = renderHook(() => useMovieStore(), { wrapper });

    let genPromise: Promise<void>;
    act(() => {
      genPromise = result.current.generateRankings();
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.cancelGeneration();
    });

    await act(async () => {
      resolveAi({
        recommendations: [makeRec(201, 'wildcard', 1)],
        usedProvider: 'Local Smart Heuristic (Zero Config)',
      });
      await genPromise!;
    });

    expect(loadOutcomeLog()).toEqual([]);
  });
});
