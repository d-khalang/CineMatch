import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RankedFeed } from '../RankedFeed';
import { Toast } from '../Toast';
import { MovieStoreProvider, useMovieStore } from '../../store/useMovieStore';
import { STORAGE_KEYS, clearInMemoryStoreForTesting } from '../../services/storage';
import { aiManager } from '../../services/ai/aiManager';

// Mock dependencies
vi.mock('../../services/tmdb', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    IMAGE_BASE_URL: 'https://image.tmdb.org/t/p/w500',
    getMovieDetails: vi.fn().mockResolvedValue(null),
    hydrateBatchWithDiscoveries: vi.fn().mockResolvedValue([]),
  };
});

// The store imports the candidate pool from its own module (CIN-21).
vi.mock('../../services/recommendation/candidateSources', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
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
      error: 'Simulated API failure',
    }),
  },
}));

describe('RankedFeed Auto-Generation & Infinite Retry Guard', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
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

describe('RankedFeed Header Rating Count & New Since (CIN-40)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    vi.clearAllMocks();
  });

  it('shows last-run count and "K new since" when ratedCount > lastRunRatedCount', () => {
    const seededRatings: Record<number, unknown> = {};
    for (let i = 1; i <= 5; i++) {
      seededRatings[i] = {
        movieId: i,
        title: `Film ${i}`,
        rating: 8,
        ratedAt: 1000 * i,
        genres: ['Drama'],
      };
    }
    localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));

    const cachedData = {
      recommendations: [
        {
          movie: {
            id: 999,
            title: 'Rec Film',
            overview: '',
            release_date: '2020-01-01',
            vote_average: 8.0,
            vote_count: 100,
            poster_path: null,
            backdrop_path: null,
            genres: [],
          },
          score: 95,
          rank: 1,
          reason: 'Match',
          serendipityType: 'safe_bet',
          highlightTags: [],
        },
      ],
      generatedAt: 100000,
      usedProvider: 'gemini',
      settingsFingerprint: 'test-fp',
      ratedCount: 3,
    };
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedData));

    render(
      <MovieStoreProvider>
        <RankedFeed />
      </MovieStoreProvider>
    );

    expect(screen.getByText(/analyzing 3 of your ratings/i)).toBeDefined();
    expect(screen.getByText(/2 new since/i)).toBeDefined();
  });

  it('shows only last-run count when ratedCount === lastRunRatedCount', () => {
    const seededRatings: Record<number, unknown> = {};
    for (let i = 1; i <= 4; i++) {
      seededRatings[i] = {
        movieId: i,
        title: `Film ${i}`,
        rating: 8,
        ratedAt: 1000 * i,
        genres: ['Drama'],
      };
    }
    localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));

    const cachedData = {
      recommendations: [
        {
          movie: {
            id: 999,
            title: 'Rec Film',
            overview: '',
            release_date: '2020-01-01',
            vote_average: 8.0,
            vote_count: 100,
            poster_path: null,
            backdrop_path: null,
            genres: [],
          },
          score: 95,
          rank: 1,
          reason: 'Match',
          serendipityType: 'safe_bet',
          highlightTags: [],
        },
      ],
      generatedAt: 100000,
      usedProvider: 'gemini',
      settingsFingerprint: 'test-fp',
      ratedCount: 4,
    };
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedData));

    render(
      <MovieStoreProvider>
        <RankedFeed />
      </MovieStoreProvider>
    );

    expect(screen.getByText(/analyzing 4 of your ratings/i)).toBeDefined();
    expect(screen.queryByText(/new since/i)).toBeNull();
  });
});

describe('RankedFeed "Seen it" & "Not for me" Hidden Films (CIN-42)', () => {
  const seededRatings = {
    101: {
      movieId: 101,
      title: 'Rated Film One',
      rating: 9,
      ratedAt: 1000,
      genres: ['Action'],
    },
    202: {
      movieId: 202,
      title: 'Rated Film Two',
      rating: 8,
      ratedAt: 2000,
      genres: ['Sci-Fi'],
    },
  };

  const cachedRecs = {
    recommendations: [
      {
        movie: {
          id: 301,
          title: 'Candidate Film A',
          overview: 'An awesome movie',
          release_date: '2021-05-15',
          vote_average: 8.5,
          vote_count: 1200,
          poster_path: null,
          backdrop_path: null,
          genres: [{ id: 18, name: 'Drama' }],
        },
        score: 94,
        rank: 1,
        reason: 'Matches your taste for drama',
        serendipityType: 'safe_bet',
        highlightTags: [],
      },
      {
        movie: {
          id: 302,
          title: 'Candidate Film B',
          overview: 'Another exciting film',
          release_date: '2022-08-20',
          vote_average: 7.9,
          vote_count: 900,
          poster_path: null,
          backdrop_path: null,
          genres: [{ id: 878, name: 'Sci-Fi' }],
        },
        score: 90,
        rank: 2,
        reason: 'Recommended based on sci-fi ratings',
        serendipityType: 'safe_bet',
        highlightTags: [],
      },
    ],
    generatedAt: 100000,
    usedProvider: 'gemini',
    settingsFingerprint: 'fingerprint-123',
    ratedCount: 2,
  };

  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    vi.clearAllMocks();
  });

  it('clicking "Seen it: <title>" removes the card, calls hideFilm with "seen", and shows the toast (AC1)', () => {
    localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedRecs));

    render(
      <MovieStoreProvider>
        <RankedFeed />
        <Toast />
      </MovieStoreProvider>
    );

    // Initial state: both cards are present
    expect(screen.getByText('Candidate Film A')).toBeInTheDocument();
    expect(screen.getByText('Candidate Film B')).toBeInTheDocument();

    // Click "Seen it: Candidate Film A"
    const seenBtn = screen.getByRole('button', { name: 'Seen it: Candidate Film A' });
    fireEvent.click(seenBtn);

    // Card A is removed, Card B remains
    expect(screen.queryByText('Candidate Film A')).toBeNull();
    expect(screen.getByText('Candidate Film B')).toBeInTheDocument();

    // Toast text appears
    expect(
      screen.getByText('Hidden "Candidate Film A". Restore it in Settings → Hidden films.')
    ).toBeInTheDocument();

    // Stored with reason 'seen'
    const storedHidden = JSON.parse(localStorage.getItem(STORAGE_KEYS.HIDDEN_FILMS) || '[]');
    expect(storedHidden).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          movieId: 301,
          reason: 'seen',
          title: 'Candidate Film A',
        }),
      ])
    );
  });

  it('clicking "Not for me: <title>" removes the card, calls hideFilm with "not_for_me", and shows the toast (AC1)', () => {
    localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedRecs));

    render(
      <MovieStoreProvider>
        <RankedFeed />
        <Toast />
      </MovieStoreProvider>
    );

    // Click "Not for me: Candidate Film B"
    const notForMeBtn = screen.getByRole('button', { name: 'Not for me: Candidate Film B' });
    fireEvent.click(notForMeBtn);

    // Card B is removed
    expect(screen.queryByText('Candidate Film B')).toBeNull();
    expect(screen.getByText('Candidate Film A')).toBeInTheDocument();

    // Toast text appears
    expect(
      screen.getByText('Hidden "Candidate Film B". Restore it in Settings → Hidden films.')
    ).toBeInTheDocument();

    // Stored with reason 'not_for_me'
    const storedHidden = JSON.parse(localStorage.getItem(STORAGE_KEYS.HIDDEN_FILMS) || '[]');
    expect(storedHidden).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          movieId: 302,
          reason: 'not_for_me',
          title: 'Candidate Film B',
        }),
      ])
    );
  });

  it('after hiding and remounting the provider with the same localStorage, the film is not in the feed (AC2)', () => {
    localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedRecs));

    // First mount
    const { unmount } = render(
      <MovieStoreProvider>
        <RankedFeed />
      </MovieStoreProvider>
    );

    expect(screen.getByText('Candidate Film A')).toBeInTheDocument();
    expect(screen.getByText('Candidate Film B')).toBeInTheDocument();

    // Hide Candidate Film A
    const seenBtn = screen.getByRole('button', { name: 'Seen it: Candidate Film A' });
    fireEvent.click(seenBtn);

    expect(screen.queryByText('Candidate Film A')).toBeNull();

    // Unmount provider
    unmount();

    // Remount provider with identical localStorage
    render(
      <MovieStoreProvider>
        <RankedFeed />
      </MovieStoreProvider>
    );

    // Film A is NOT in the feed; Film B remains
    expect(screen.queryByText('Candidate Film A')).toBeNull();
    expect(screen.getByText('Candidate Film B')).toBeInTheDocument();
  });

  it('both new buttons can be reached by keyboard and have accessible names that include the title (AC4)', () => {
    localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedRecs));

    render(
      <MovieStoreProvider>
        <RankedFeed />
      </MovieStoreProvider>
    );

    const seenBtn = screen.getByRole('button', { name: /Seen it: Candidate Film A/i });
    const notForMeBtn = screen.getByRole('button', { name: /Not for me: Candidate Film A/i });

    expect(seenBtn).toBeInTheDocument();
    expect(notForMeBtn).toBeInTheDocument();

    // Verify focus-ring class
    expect(seenBtn).toHaveClass('focus-ring');
    expect(notForMeBtn).toHaveClass('focus-ring');

    // Verify tap target classes (AC6)
    expect(seenBtn).toHaveClass('py-2', 'sm:py-0.5');
    expect(notForMeBtn).toHaveClass('py-2', 'sm:py-0.5');

    // Verify keyboard reachability
    seenBtn.focus();
    expect(document.activeElement).toBe(seenBtn);

    notForMeBtn.focus();
    expect(document.activeElement).toBe(notForMeBtn);
  });

  it('hidden film cannot flash back during or after an in-flight generation (Review focus)', async () => {
    localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedRecs));

    let resolveDeferred!: (value: unknown) => void;
    const deferredPromise = new Promise((resolve) => {
      resolveDeferred = resolve;
    });

    vi.mocked(aiManager.generateRecommendations).mockReturnValue(deferredPromise as any);

    let storeCapture: ReturnType<typeof useMovieStore> | null = null;
    const StoreSpy = () => {
      storeCapture = useMovieStore();
      return null;
    };

    render(
      <MovieStoreProvider>
        <StoreSpy />
        <RankedFeed />
      </MovieStoreProvider>
    );

    // Initial state: Candidate Film A and Candidate Film B are rendered
    expect(screen.getByText('Candidate Film A')).toBeInTheDocument();
    expect(screen.getByText('Candidate Film B')).toBeInTheDocument();

    // Start generation (Re-Rank with AI)
    const reRankBtn = screen.getByRole('button', { name: /Re-Rank with AI/i });
    await act(async () => {
      fireEvent.click(reRankBtn);
    });

    // Generation is now pending
    expect(aiManager.generateRecommendations).toHaveBeenCalledTimes(1);
    expect(storeCapture!.isGeneratingRecs).toBe(true);

    // While generation is pending, hide Candidate Film A through the store
    act(() => {
      storeCapture!.hideFilm(301, 'seen', 'Candidate Film A');
    });

    expect(storeCapture!.hiddenFilms.some((h) => h.movieId === 301)).toBe(true);

    // Resolve deferred promise with a result containing Candidate Film A
    await act(async () => {
      resolveDeferred({
        recommendations: [
          {
            movie: {
              id: 301,
              title: 'Candidate Film A',
              overview: 'An awesome movie',
              release_date: '2021-05-15',
              vote_average: 8.5,
              vote_count: 1200,
              poster_path: null,
              backdrop_path: null,
              genres: [{ id: 18, name: 'Drama' }],
            },
            score: 95,
            rank: 1,
            reason: 'Matches your taste for drama',
            serendipityType: 'safe_bet',
            highlightTags: [],
          },
          {
            movie: {
              id: 302,
              title: 'Candidate Film B',
              overview: 'Another exciting film',
              release_date: '2022-08-20',
              vote_average: 7.9,
              vote_count: 900,
              poster_path: null,
              backdrop_path: null,
              genres: [{ id: 878, name: 'Sci-Fi' }],
            },
            score: 90,
            rank: 2,
            reason: 'Recommended based on sci-fi ratings',
            serendipityType: 'safe_bet',
            highlightTags: [],
          },
        ],
        usedProvider: 'gemini',
      });
    });

    expect(storeCapture!.isGeneratingRecs).toBe(false);

    // Candidate Film A never appears in the feed; Candidate Film B remains
    expect(screen.queryByText('Candidate Film A')).toBeNull();
    expect(screen.getByText('Candidate Film B')).toBeInTheDocument();

    // Verify persisted cache excludes Film A and retains Film B
    const storedRecs = JSON.parse(
      localStorage.getItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS) || '{}'
    );
    expect(
      storedRecs.recommendations?.some((r: { movie: { id: number } }) => r.movie.id === 301)
    ).toBe(false);
    expect(
      storedRecs.recommendations?.some((r: { movie: { id: number } }) => r.movie.id === 302)
    ).toBe(true);
  });

  it('moves focus after clicking Seen it or Not for me to next card, previous card, or feed h1 (CIN-44)', () => {
    const threeRecs = {
      ...cachedRecs,
      recommendations: [
        cachedRecs.recommendations[0], // 301: Candidate Film A
        cachedRecs.recommendations[1], // 302: Candidate Film B
        {
          movie: {
            id: 303,
            title: 'Candidate Film C',
            overview: 'Third movie',
            release_date: '2023-01-01',
            vote_average: 7.0,
            vote_count: 500,
            poster_path: null,
            backdrop_path: null,
            genres: [{ id: 35, name: 'Comedy' }],
          },
          score: 85,
          rank: 3,
          reason: 'Comedy match',
          serendipityType: 'safe_bet',
          highlightTags: [],
        },
      ],
    };
    localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(threeRecs));

    render(
      <MovieStoreProvider>
        <RankedFeed />
      </MovieStoreProvider>
    );

    // 1. Click "Seen it: Candidate Film A" (index 0).
    // Focus moves to the next card's "Seen it" button (Candidate Film B).
    const seenBtnA = screen.getByRole('button', { name: 'Seen it: Candidate Film A' });
    fireEvent.click(seenBtnA);

    const seenBtnB = screen.getByRole('button', { name: 'Seen it: Candidate Film B' });
    expect(document.activeElement).toBe(seenBtnB);
    expect(document.activeElement).not.toBe(document.body);

    // 2. Click "Not for me: Candidate Film C" (the last card, now at index 1).
    // There is no next card, so focus moves to previous card's "Seen it" button (Candidate Film B).
    const notForMeBtnC = screen.getByRole('button', { name: 'Not for me: Candidate Film C' });
    fireEvent.click(notForMeBtnC);

    expect(document.activeElement).toBe(seenBtnB);
    expect(document.activeElement).not.toBe(document.body);

    // 3. Click "Seen it: Candidate Film B" (the only card remaining).
    // When there are none at all, focus moves to the feed's h1.
    fireEvent.click(seenBtnB);

    const heading = screen.getByRole('heading', { level: 1, name: /Top Ranked Movies for You/i });
    expect(document.activeElement).toBe(heading);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('moves focus after clicking Not for me to next card or feed h1 (CIN-44)', () => {
    localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedRecs));

    render(
      <MovieStoreProvider>
        <RankedFeed />
      </MovieStoreProvider>
    );

    // 1. Click "Not for me: Candidate Film A" (index 0 of 2).
    // Focus moves to next card's "Seen it" button (Candidate Film B).
    const notForMeBtnA = screen.getByRole('button', { name: 'Not for me: Candidate Film A' });
    fireEvent.click(notForMeBtnA);

    const seenBtnB = screen.getByRole('button', { name: 'Seen it: Candidate Film B' });
    expect(document.activeElement).toBe(seenBtnB);
    expect(document.activeElement).not.toBe(document.body);

    // 2. Click "Not for me: Candidate Film B" (only remaining card).
    // Focus moves to feed h1 heading.
    const notForMeBtnB = screen.getByRole('button', { name: 'Not for me: Candidate Film B' });
    fireEvent.click(notForMeBtnB);

    const heading = screen.getByRole('heading', { level: 1, name: /Top Ranked Movies for You/i });
    expect(document.activeElement).toBe(heading);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('hiding the last card does not trigger auto-generation (CIN-44)', async () => {
    localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));
    const singleCardRecs = {
      ...cachedRecs,
      recommendations: [cachedRecs.recommendations[0]], // only Candidate Film A
    };
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(singleCardRecs));

    render(
      <MovieStoreProvider>
        <RankedFeed />
      </MovieStoreProvider>
    );

    expect(screen.getByText('Candidate Film A')).toBeInTheDocument();
    expect(aiManager.generateRecommendations).not.toHaveBeenCalled();

    const seenBtn = screen.getByRole('button', { name: 'Seen it: Candidate Film A' });
    fireEvent.click(seenBtn);

    // Card is removed and empty batch state is rendered
    expect(screen.queryByText('Candidate Film A')).toBeNull();
    expect(screen.getByText('Generate AI Rankings')).toBeInTheDocument();

    // Focus moves to heading
    const heading = screen.getByRole('heading', { level: 1, name: /Top Ranked Movies for You/i });
    expect(document.activeElement).toBe(heading);
    expect(document.activeElement).not.toBe(document.body);

    // Must NOT call generateRecommendations even after a tick
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(aiManager.generateRecommendations).not.toHaveBeenCalled();
  });

  it('hiding the last card with "Not for me" does not trigger auto-generation (CIN-44)', async () => {
    localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));
    const singleCardRecs = {
      ...cachedRecs,
      recommendations: [cachedRecs.recommendations[0]], // only Candidate Film A
    };
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(singleCardRecs));

    render(
      <MovieStoreProvider>
        <RankedFeed />
      </MovieStoreProvider>
    );

    expect(screen.getByText('Candidate Film A')).toBeInTheDocument();
    expect(aiManager.generateRecommendations).not.toHaveBeenCalled();

    const notForMeBtn = screen.getByRole('button', { name: 'Not for me: Candidate Film A' });
    fireEvent.click(notForMeBtn);

    // Card is removed and empty batch state is rendered
    expect(screen.queryByText('Candidate Film A')).toBeNull();
    expect(screen.getByText('Generate AI Rankings')).toBeInTheDocument();

    // Focus moves to heading
    const heading = screen.getByRole('heading', { level: 1, name: /Top Ranked Movies for You/i });
    expect(document.activeElement).toBe(heading);
    expect(document.activeElement).not.toBe(document.body);

    // Must NOT call generateRecommendations even after a tick
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(aiManager.generateRecommendations).not.toHaveBeenCalled();
  });

  it('keyboard tab order on the recommendation card is sequential and sensible (Review focus)', async () => {
    const user = userEvent.setup();
    localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedRecs));

    render(
      <MovieStoreProvider>
        <RankedFeed />
      </MovieStoreProvider>
    );

    const rate10Btn = screen.getAllByRole('radio', { name: /Rate 10 out of 10/i })[0];
    const seenBtn = screen.getByRole('button', { name: 'Seen it: Candidate Film A' });
    const notForMeBtn = screen.getByRole('button', { name: 'Not for me: Candidate Film A' });
    const detailsBtn = screen.getAllByRole('button', { name: 'Trailer & Details' })[0];

    // Focus the rating strip radio button 10
    rate10Btn.focus();
    expect(document.activeElement).toBe(rate10Btn);

    // Tab directly to Seen it
    await user.tab();
    expect(document.activeElement).toBe(seenBtn);

    // Tab directly to Not for me
    await user.tab();
    expect(document.activeElement).toBe(notForMeBtn);

    // Tab directly to Trailer & Details
    await user.tab();
    expect(document.activeElement).toBe(detailsBtn);
  });

  it('hiding a movie currently in grace period immediately removes it and cancels the pending timer', () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));
      localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedRecs));

      render(
        <MovieStoreProvider>
          <RankedFeed />
          <Toast />
        </MovieStoreProvider>
      );

      // Rate Candidate Film A with 8
      const rate8Btn = screen.getAllByRole('radio', { name: /Rate 8 out of 10/i })[0];
      fireEvent.click(rate8Btn);

      // Enters grace period: banner is visible
      expect(screen.getByText(/Grade saved! Hiding soon\.\.\./i)).toBeInTheDocument();
      expect(screen.getByText('Candidate Film A')).toBeInTheDocument();

      // Click "Seen it: Candidate Film A"
      const seenBtn = screen.getByRole('button', { name: 'Seen it: Candidate Film A' });
      fireEvent.click(seenBtn);

      // Card is immediately removed, grace banner is gone
      expect(screen.queryByText('Candidate Film A')).toBeNull();
      expect(screen.queryByText(/Grade saved! Hiding soon\.\.\./i)).toBeNull();

      // Advance timers by 5000ms: no resurrection
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.queryByText('Candidate Film A')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('falls back to #<movieId> when movie.title is missing or whitespace-only', () => {
    localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));
    const recsWithEmptyTitle = {
      ...cachedRecs,
      recommendations: [
        {
          ...cachedRecs.recommendations[0],
          movie: {
            ...cachedRecs.recommendations[0].movie,
            id: 999,
            title: '   ',
          },
        },
      ],
    };
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(recsWithEmptyTitle));

    render(
      <MovieStoreProvider>
        <RankedFeed />
        <Toast />
      </MovieStoreProvider>
    );

    const seenBtn = screen.getByRole('button', { name: 'Seen it: #999' });
    const notForMeBtn = screen.getByRole('button', { name: 'Not for me: #999' });
    expect(seenBtn).toBeInTheDocument();
    expect(notForMeBtn).toBeInTheDocument();

    fireEvent.click(seenBtn);
    expect(
      screen.getByText('Hidden "#999". Restore it in Settings → Hidden films.')
    ).toBeInTheDocument();
  });
});
