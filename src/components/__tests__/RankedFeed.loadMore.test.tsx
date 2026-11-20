import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { RankedFeed } from '../RankedFeed';
import { MovieStoreProvider } from '../../store/useMovieStore';
import { STORAGE_KEYS, clearInMemoryStoreForTesting } from '../../services/storage';
import * as candidateSources from '../../services/recommendation/candidateSources';
import type { Candidate, SourceCursor } from '../../services/recommendation/types';
import type { Movie } from '../../types';

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
  const actual = await importOriginal<typeof import('../../services/recommendation/candidateSources')>();
  return {
    ...actual,
    getCandidateRecommendationPool: vi.fn(),
    loadMoreCandidates: vi.fn(),
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
    generateRecommendations: vi.fn().mockImplementation(async (_providerId, req) => ({
      recommendations: (req.candidatePool || []).map((movie: Movie, idx: number) => ({
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

function makeMovie(id: number, title = `Film ${id}`): Movie {
  return {
    id,
    title,
    overview: `Overview for ${title}`,
    release_date: '2021-01-01',
    vote_average: 8.1,
    vote_count: 800,
    poster_path: `/p${id}.jpg`,
    backdrop_path: null,
    genres: [{ id: 18, name: 'Drama' }],
  };
}

function makeCandidate(id: number, title = `More Film ${id}`): Candidate {
  return {
    movie: makeMovie(id, title),
    sources: ['hidden_gem'],
    seedNeighbour: false,
  };
}

function seedRatings() {
  localStorage.setItem(
    STORAGE_KEYS.RATINGS,
    JSON.stringify({
      1: {
        movieId: 1,
        title: 'Rated 1',
        rating: 9,
        ratedAt: 1000,
        genres: ['Drama'],
      },
      2: {
        movieId: 2,
        title: 'Rated 2',
        rating: 8,
        ratedAt: 2000,
        genres: ['Drama'],
      },
    })
  );
}

describe('RankedFeed Show more UI & accessibility (CIN-11)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    vi.clearAllMocks();
    seedRatings();
  });

  it('shows loading (aria-busy), appends new cards, moves focus to the first new card, and transitions to exhausted', async () => {
    vi.mocked(candidateSources.getCandidateRecommendationPool).mockImplementationOnce(
      async (options) => {
        options?.onCursors?.([
          { source: 'seed_graph', key: 'recommendations:1', nextPage: 2, exhausted: false },
        ]);
        return [makeMovie(101, 'Initial Film One'), makeMovie(102, 'Initial Film Two')];
      }
    );

    let resolveMore!: (val: { candidates: Candidate[]; cursors: SourceCursor[] }) => void;
    vi.mocked(candidateSources.loadMoreCandidates).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMore = resolve;
        })
    );

    render(
      <MovieStoreProvider>
        <RankedFeed />
      </MovieStoreProvider>
    );

    // Wait for auto-generation to complete and show initial cards + Show more button
    await waitFor(() => {
      expect(screen.getByText('Initial Film One')).toBeInTheDocument();
      expect(screen.getByText('Initial Film Two')).toBeInTheDocument();
    });

    const showMoreBtn = screen.getByRole('button', { name: 'Show more' });
    expect(showMoreBtn).toBeEnabled();
    expect(showMoreBtn).toHaveAttribute('aria-busy', 'false');
    expect(showMoreBtn).toHaveClass('focus-ring');

    // Keyboard reachability
    showMoreBtn.focus();
    expect(document.activeElement).toBe(showMoreBtn);

    // Trigger load more
    fireEvent.click(showMoreBtn);

    const loadingBtn = screen.getByRole('button', { name: 'Loading more...' });
    expect(loadingBtn).toBeDisabled();
    expect(loadingBtn).toHaveAttribute('aria-busy', 'true');

    // Resolve with 2 new movies and non-exhausted cursor
    await act(async () => {
      resolveMore({
        candidates: [
          makeCandidate(201, 'Appended Film Alpha'),
          makeCandidate(202, 'Appended Film Beta'),
        ],
        cursors: [{ source: 'seed_graph', key: 'recommendations:1', nextPage: 3, exhausted: false }],
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Appended Film Alpha')).toBeInTheDocument();
      expect(screen.getByText('Appended Film Beta')).toBeInTheDocument();
    });

    // Continued ranks (#3 and #4)
    expect(screen.getByText('#3')).toBeInTheDocument();
    expect(screen.getByText('#4')).toBeInTheDocument();

    // Focus moved to the first newly appended card
    const cards = Array.from(document.querySelectorAll<HTMLDivElement>('div[data-movie-id]'));
    expect(cards).toHaveLength(4);
    const firstNewCard = cards[2];
    expect(['201', '202']).toContain(firstNewCard.getAttribute('data-movie-id'));
    expect(document.activeElement).toBe(firstNewCard);

    // Second click exhausts cursors -> "No more right now"
    vi.mocked(candidateSources.loadMoreCandidates).mockResolvedValueOnce({
      candidates: [],
      cursors: [{ source: 'seed_graph', key: 'recommendations:1', nextPage: 4, exhausted: true }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));

    await waitFor(() => {
      const exhaustedBtn = screen.getByRole('button', { name: 'No more right now' });
      expect(exhaustedBtn).toBeDisabled();
      expect(exhaustedBtn).toHaveAttribute('aria-busy', 'false');
    });
  });

  it('displays error state and allows retrying via keyboard-accessible button', async () => {
    vi.mocked(candidateSources.getCandidateRecommendationPool).mockImplementationOnce(
      async (options) => {
        options?.onCursors?.([
          { source: 'seed_graph', key: 'recommendations:1', nextPage: 2, exhausted: false },
        ]);
        return [makeMovie(101, 'Initial Film One')];
      }
    );

    vi.mocked(candidateSources.loadMoreCandidates).mockRejectedValueOnce(new Error('TMDB 500'));

    render(
      <MovieStoreProvider>
        <RankedFeed />
      </MovieStoreProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Initial Film One')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/couldn't load more recommendations/i);
    });

    const retryBtn = screen.getByRole('button', { name: 'Try again' });
    expect(retryBtn).toBeEnabled();
    expect(retryBtn).toHaveAttribute('aria-busy', 'false');

    // Retry succeeds
    vi.mocked(candidateSources.loadMoreCandidates).mockResolvedValueOnce({
      candidates: [makeCandidate(301, 'Recovered Film')],
      cursors: [{ source: 'seed_graph', key: 'recommendations:1', nextPage: 3, exhausted: true }],
    });

    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText('Recovered Film')).toBeInTheDocument();
    });

    const firstNewCard = document.querySelector<HTMLDivElement>('div[data-movie-id="301"]');
    expect(document.activeElement).toBe(firstNewCard);
    expect(screen.getByRole('button', { name: 'No more right now' })).toBeDisabled();
  });
});
