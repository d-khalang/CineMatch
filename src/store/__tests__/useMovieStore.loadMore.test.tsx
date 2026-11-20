import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MovieStoreProvider, useMovieStore } from '../useMovieStore';
import { credentialStore } from '../../services/credentialStore';
import { clearInMemoryStoreForTesting, STORAGE_KEYS } from '../../services/storage';
import { readRecommendationCache } from '../recommendationCache';
import * as candidateSources from '../../services/recommendation/candidateSources';
import type { Candidate, SourceCursor } from '../../services/recommendation/types';
import type { Movie, UserRating } from '../../types';

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

vi.mock('../../services/ai/aiManager', () => ({
  aiManager: {
    generateRecommendations: vi.fn().mockImplementation(async (_providerId, req) => ({
      recommendations: (req.candidatePool || []).slice(0, 5).map((movie: Movie, idx: number) => ({
        movie,
        score: 95 - idx,
        rank: idx + 1,
        reason: 'Initial pick',
        serendipityType: 'safe_bet' as const,
        highlightTags: ['Drama'],
        bucket: 'safe_bet' as const,
      })),
      usedProvider: 'Local Smart Heuristic (Zero Config)',
    })),
  },
}));

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MovieStoreProvider>{children}</MovieStoreProvider>
);

function makeMovie(id: number, title?: string): Movie {
  return {
    id,
    title: title ?? `Movie-${id}-Feature`,
    overview: `Overview for ${id}`,
    poster_path: `/p${id}.jpg`,
    backdrop_path: null,
    release_date: '2018-05-01',
    vote_average: 7.9,
    vote_count: 600 + id,
    genres: [{ id: 18, name: 'Drama' }],
  };
}

function makeCandidate(id: number, source: Candidate['sources'][number] = 'hidden_gem'): Candidate {
  return {
    movie: makeMovie(id),
    sources: [source],
    seedNeighbour: source === 'seed_graph',
  };
}

function seedTwoRatings(): Record<number, UserRating> {
  const ratings: Record<number, UserRating> = {
    1: {
      movieId: 1,
      title: 'Seed Film 1',
      rating: 10,
      posterPath: '/s1.jpg',
      genres: ['Drama'],
      year: '2015',
      ratedAt: 1000,
    },
    2: {
      movieId: 2,
      title: 'Seed Film 2',
      rating: 9,
      posterPath: '/s2.jpg',
      genres: ['Drama'],
      year: '2017',
      ratedAt: 2000,
    },
  };
  localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(ratings));
  return ratings;
}

describe('useMovieStore loadMoreRankings (CIN-11)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    credentialStore.setTmdbCredential('read_access_token', 'test-token');
    vi.clearAllMocks();
  });

  it('appends up to 15 ranked items with continued ranks, no duplicates, excludes shown/rated/hidden, and updates cache', async () => {
    seedTwoRatings();

    const initialPool = [101, 102, 103].map((id) => makeMovie(id));
    const initialCursors: SourceCursor[] = [
      { source: 'seed_graph', key: 'recommendations:1', nextPage: 2, exhausted: false },
    ];

    vi.mocked(candidateSources.getCandidateRecommendationPool).mockImplementationOnce(
      async (options) => {
        options?.onCursors?.(initialCursors);
        return initialPool;
      }
    );

    const { result } = renderHook(() => useMovieStore(), { wrapper });

    // Hide a movie (305) before generating and loading more
    act(() => {
      result.current.hideFilm(305, 'not_for_me', 'Hidden Film 305');
    });

    await act(async () => {
      await result.current.generateRankings();
    });

    expect(result.current.recommendations.map((r) => r.movie.id)).toEqual([101, 102, 103]);
    expect(result.current.recommendations.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(result.current.loadMoreStatus).toBe('idle');

    // Return 18 candidates (plus a duplicate of 101 that shouldn't slip through)
    const nextBatchCandidates: Candidate[] = [
      makeCandidate(101, 'seed_graph'),
      ...Array.from({ length: 18 }, (_, i) => makeCandidate(500 + i, 'hidden_gem')),
    ];
    const nextCursors: SourceCursor[] = [
      { source: 'seed_graph', key: 'recommendations:1', nextPage: 3, exhausted: false },
    ];

    vi.mocked(candidateSources.loadMoreCandidates).mockResolvedValueOnce({
      candidates: nextBatchCandidates,
      cursors: nextCursors,
    });

    await act(async () => {
      await result.current.loadMoreRankings();
    });

    // Verify excludeIds passed to loadMoreCandidates includes shown (101,102,103), rated (1,2), and hidden (305)
    const callArgs = vi.mocked(candidateSources.loadMoreCandidates).mock.calls[0];
    const excludeSet = callArgs[2] as Set<number>;
    expect(excludeSet.has(101)).toBe(true);
    expect(excludeSet.has(102)).toBe(true);
    expect(excludeSet.has(103)).toBe(true);
    expect(excludeSet.has(1)).toBe(true);
    expect(excludeSet.has(2)).toBe(true);
    expect(excludeSet.has(305)).toBe(true);

    // 3 initial + 15 appended = 18 total, ranks 1..18, no duplicates
    expect(result.current.recommendations).toHaveLength(18);
    expect(result.current.recommendations.slice(0, 3).map((r) => r.movie.id)).toEqual([101, 102, 103]);
    expect(result.current.recommendations.map((r) => r.rank)).toEqual(
      Array.from({ length: 18 }, (_, i) => i + 1)
    );
    const allIds = result.current.recommendations.map((r) => r.movie.id);
    expect(new Set(allIds).size).toBe(18);
    expect(result.current.isLoadingMore).toBe(false);
    expect(result.current.loadMoreStatus).toBe('idle');

    // Recommendation cache must persist all 18 items
    const cached = readRecommendationCache();
    expect(cached?.recommendations).toHaveLength(18);
    expect(cached?.recommendations.map((r) => r.movie.id)).toEqual(allIds);
  });

  it('sets loadMoreStatus to exhausted when cursors are exhausted or no new candidates remain', async () => {
    seedTwoRatings();

    vi.mocked(candidateSources.getCandidateRecommendationPool).mockImplementationOnce(
      async (options) => {
        options?.onCursors?.([
          { source: 'seed_graph', key: 'recommendations:1', nextPage: 2, exhausted: false },
        ]);
        return [makeMovie(101)];
      }
    );

    const { result } = renderHook(() => useMovieStore(), { wrapper });

    await act(async () => {
      await result.current.generateRankings();
    });

    vi.mocked(candidateSources.loadMoreCandidates).mockResolvedValueOnce({
      candidates: [],
      cursors: [{ source: 'seed_graph', key: 'recommendations:1', nextPage: 3, exhausted: true }],
    });

    await act(async () => {
      await result.current.loadMoreRankings();
    });

    expect(result.current.loadMoreStatus).toBe('exhausted');
    expect(result.current.recommendations).toHaveLength(1);

    // Clicking loadMoreRankings again when already exhausted makes 0 additional calls
    await act(async () => {
      await result.current.loadMoreRankings();
    });
    expect(candidateSources.loadMoreCandidates).toHaveBeenCalledTimes(1);
    expect(result.current.loadMoreStatus).toBe('exhausted');

    // Rating a film after exhaustion keeps loadMoreStatus as 'exhausted'
    await act(async () => {
      await result.current.setRating(makeMovie(101, 'Rated After Exhaustion'), 9);
    });
    expect(result.current.loadMoreStatus).toBe('exhausted');
  });

  it('sets loadMoreStatus to exhausted when called before any generation', async () => {
    seedTwoRatings();
    const { result } = renderHook(() => useMovieStore(), { wrapper });

    await act(async () => {
      await result.current.loadMoreRankings();
    });

    expect(candidateSources.loadMoreCandidates).not.toHaveBeenCalled();
    expect(result.current.loadMoreStatus).toBe('exhausted');
  });

  it('discards loadMoreRankings result if a rating changes while load-more is in flight', async () => {
    seedTwoRatings();

    vi.mocked(candidateSources.getCandidateRecommendationPool).mockImplementationOnce(
      async (options) => {
        options?.onCursors?.([
          { source: 'seed_graph', key: 'recommendations:1', nextPage: 2, exhausted: false },
        ]);
        return [makeMovie(101), makeMovie(102)];
      }
    );

    const { result } = renderHook(() => useMovieStore(), { wrapper });

    await act(async () => {
      await result.current.generateRankings();
    });

    let resolveDeferred!: (val: { candidates: Candidate[]; cursors: SourceCursor[] }) => void;
    const deferred = new Promise<{ candidates: Candidate[]; cursors: SourceCursor[] }>((resolve) => {
      resolveDeferred = resolve;
    });

    // Deliberately ignore signal in mock to prove generation/invalidation guard also discards
    vi.mocked(candidateSources.loadMoreCandidates).mockReturnValueOnce(deferred);

    let loadPromise: Promise<void>;
    act(() => {
      loadPromise = result.current.loadMoreRankings();
    });
    expect(result.current.isLoadingMore).toBe(true);

    // Rate a movie while loadMoreRankings is in flight
    await act(async () => {
      await result.current.setRating(makeMovie(999, 'New Rated Film'), 8);
    });

    // Resolve deferred loadMoreCandidates with new candidates
    await act(async () => {
      resolveDeferred({
        candidates: [makeCandidate(701), makeCandidate(702)],
        cursors: [{ source: 'seed_graph', key: 'recommendations:1', nextPage: 3, exhausted: false }],
      });
      await loadPromise!;
    });

    // Stale load-more result must be discarded!
    expect(result.current.recommendations.map((r) => r.movie.id)).toEqual([101, 102]);
    expect(result.current.isLoadingMore).toBe(false);
    expect(readRecommendationCache()?.recommendations.map((r) => r.movie.id)).toEqual([101, 102]);
  });

  it('discards loadMoreRankings result on settings change or abort, leaving list unchanged', async () => {
    seedTwoRatings();

    vi.mocked(candidateSources.getCandidateRecommendationPool).mockImplementationOnce(
      async (options) => {
        options?.onCursors?.([
          { source: 'seed_graph', key: 'recommendations:1', nextPage: 2, exhausted: false },
        ]);
        return [makeMovie(101)];
      }
    );

    const { result } = renderHook(() => useMovieStore(), { wrapper });

    await act(async () => {
      await result.current.generateRankings();
    });

    let capturedSignal: AbortSignal | undefined;
    let rejectDeferred!: (err: Error) => void;
    vi.mocked(candidateSources.loadMoreCandidates).mockImplementationOnce(
      (_cursors, _ratings, _exclude, signal) => {
        capturedSignal = signal;
        return new Promise((_resolve, reject) => {
          rejectDeferred = reject;
          signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        });
      }
    );

    let loadPromise: Promise<void>;
    act(() => {
      loadPromise = result.current.loadMoreRankings();
    });
    expect(result.current.isLoadingMore).toBe(true);
    expect(result.current.loadMoreStatus).toBe('loading');

    // Abort via cancelGeneration
    act(() => {
      result.current.cancelGeneration();
    });

    expect(capturedSignal?.aborted).toBe(true);
    await act(async () => {
      rejectDeferred(new DOMException('The operation was aborted', 'AbortError'));
      await loadPromise!;
    });

    expect(result.current.recommendations.map((r) => r.movie.id)).toEqual([101]);
    expect(result.current.isLoadingMore).toBe(false);
    expect(result.current.loadMoreStatus).toBe('idle');
  });

  it('discards loadMoreRankings result when AI settings change while load-more is in flight', async () => {
    seedTwoRatings();

    vi.mocked(candidateSources.getCandidateRecommendationPool).mockImplementationOnce(
      async (options) => {
        options?.onCursors?.([
          { source: 'seed_graph', key: 'recommendations:1', nextPage: 2, exhausted: false },
        ]);
        return [makeMovie(101)];
      }
    );

    const { result } = renderHook(() => useMovieStore(), { wrapper });

    await act(async () => {
      await result.current.generateRankings();
    });

    let capturedSignal: AbortSignal | undefined;
    let resolveDeferred!: (val: { candidates: Candidate[]; cursors: SourceCursor[] }) => void;
    vi.mocked(candidateSources.loadMoreCandidates).mockImplementationOnce(
      (_cursors, _ratings, _exclude, signal) => {
        capturedSignal = signal;
        return new Promise((resolve) => {
          resolveDeferred = resolve;
        });
      }
    );

    let loadPromise: Promise<void>;
    act(() => {
      loadPromise = result.current.loadMoreRankings();
    });
    expect(result.current.isLoadingMore).toBe(true);

    // Change settings while loadMoreRankings is in flight
    act(() => {
      result.current.updateAISettings({ serendipityLevel: 85 });
    });

    expect(capturedSignal?.aborted).toBe(true);

    // Even if the underlying call ignores signal and resolves, result must be discarded
    await act(async () => {
      resolveDeferred({
        candidates: [makeCandidate(701), makeCandidate(702)],
        cursors: [{ source: 'seed_graph', key: 'recommendations:1', nextPage: 3, exhausted: false }],
      });
      await loadPromise!;
    });

    expect(result.current.recommendations.map((r) => r.movie.id)).toEqual([101]);
    expect(result.current.isLoadingMore).toBe(false);
    expect(result.current.loadMoreStatus).toBe('idle');
  });

  it('excludes films hidden while loadMoreRankings is in flight before appending', async () => {
    seedTwoRatings();

    vi.mocked(candidateSources.getCandidateRecommendationPool).mockImplementationOnce(
      async (options) => {
        options?.onCursors?.([
          { source: 'seed_graph', key: 'recommendations:1', nextPage: 2, exhausted: false },
        ]);
        return [makeMovie(101)];
      }
    );

    const { result } = renderHook(() => useMovieStore(), { wrapper });

    await act(async () => {
      await result.current.generateRankings();
    });

    let resolveDeferred!: (val: { candidates: Candidate[]; cursors: SourceCursor[] }) => void;
    vi.mocked(candidateSources.loadMoreCandidates).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDeferred = resolve;
        })
    );

    let loadPromise: Promise<void>;
    act(() => {
      loadPromise = result.current.loadMoreRankings();
    });

    // Hide 701 while load-more is in flight
    act(() => {
      result.current.hideFilm(701, 'not_for_me', 'Movie-701-Feature');
    });

    await act(async () => {
      resolveDeferred({
        candidates: [makeCandidate(701), makeCandidate(702)],
        cursors: [{ source: 'seed_graph', key: 'recommendations:1', nextPage: 3, exhausted: false }],
      });
      await loadPromise!;
    });

    expect(result.current.recommendations.map((r) => r.movie.id)).toEqual([101, 702]);
    expect(result.current.recommendations.map((r) => r.rank)).toEqual([1, 2]);
  });

  it('sets loadMoreStatus to error on failure and preserves cursors for retry', async () => {
    seedTwoRatings();

    vi.mocked(candidateSources.getCandidateRecommendationPool).mockImplementationOnce(
      async (options) => {
        options?.onCursors?.([
          { source: 'seed_graph', key: 'recommendations:1', nextPage: 2, exhausted: false },
        ]);
        return [makeMovie(101)];
      }
    );

    const { result } = renderHook(() => useMovieStore(), { wrapper });

    await act(async () => {
      await result.current.generateRankings();
    });

    vi.mocked(candidateSources.loadMoreCandidates).mockRejectedValueOnce(new Error('Network error'));

    await act(async () => {
      await result.current.loadMoreRankings();
    });

    expect(result.current.loadMoreStatus).toBe('error');
    expect(result.current.isLoadingMore).toBe(false);
    expect(result.current.recommendations.map((r) => r.movie.id)).toEqual([101]);

    // Retry succeeds using preserved cursors
    vi.mocked(candidateSources.loadMoreCandidates).mockResolvedValueOnce({
      candidates: [makeCandidate(801)],
      cursors: [{ source: 'seed_graph', key: 'recommendations:1', nextPage: 3, exhausted: true }],
    });

    await act(async () => {
      await result.current.loadMoreRankings();
    });

    expect(result.current.recommendations.map((r) => r.movie.id)).toEqual([101, 801]);
    expect(result.current.recommendations.map((r) => r.rank)).toEqual([1, 2]);
    expect(result.current.loadMoreStatus).toBe('exhausted');
  });
});
