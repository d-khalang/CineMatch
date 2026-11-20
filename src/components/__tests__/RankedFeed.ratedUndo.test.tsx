import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import { RankedFeed } from '../RankedFeed';
import { MovieStoreProvider } from '../../store/useMovieStore';
import { STORAGE_KEYS, clearInMemoryStoreForTesting } from '../../services/storage';

const dismissSpy = vi.fn();

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
    getCandidateRecommendationPool: vi.fn().mockResolvedValue([]),
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

vi.mock('../../store/useMovieStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/useMovieStore')>();
  return {
    ...actual,
    useMovieStore: () => {
      const store = actual.useMovieStore();
      return {
        ...store,
        dismissRecommendation: (movieId: number) => {
          dismissSpy(movieId);
          store.dismissRecommendation(movieId);
        },
      };
    },
  };
});

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

function seedStore() {
  localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));
  localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedRecs));
}

describe('RankedFeed rated-card undo & grace timer (CIN-52)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    vi.clearAllMocks();
    dismissSpy.mockClear();
  });

  it('shows "Rated 8/10, moved to My Ratings" in a status region with an Undo button, keeps the card at 7.9s, and dismisses after 8s', () => {
    vi.useFakeTimers();
    try {
      seedStore();

      render(
        <MovieStoreProvider>
          <RankedFeed />
        </MovieStoreProvider>
      );

      const cardA = document.querySelector<HTMLDivElement>('div[data-movie-id="301"]')!;
      const rate8Btn = within(cardA).getByRole('radio', { name: /Rate 8 out of 10/i });
      fireEvent.click(rate8Btn);

      const statusRegion = within(cardA).getByRole('status');
      expect(statusRegion).toHaveTextContent('Rated 8/10, moved to My Ratings');

      const undoBtn = within(statusRegion).getByRole('button', {
        name: 'Undo rating for Candidate Film A',
      });
      expect(undoBtn).toHaveAttribute('type', 'button');
      expect(undoBtn).toHaveTextContent('Undo');

      // Still present at 7.9 seconds
      act(() => {
        vi.advanceTimersByTime(7900);
      });
      expect(screen.getByText('Candidate Film A')).toBeInTheDocument();
      expect(dismissSpy).not.toHaveBeenCalled();

      // Dismissed after 8 seconds (once only)
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(screen.queryByText('Candidate Film A')).toBeNull();
      expect(screen.getByText('Candidate Film B')).toBeInTheDocument();
      expect(dismissSpy).toHaveBeenCalledTimes(1);
      expect(dismissSpy).toHaveBeenCalledWith(301);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Undo removes the rating, keeps the card, cancels removal, and moves focus to the rating control', () => {
    vi.useFakeTimers();
    try {
      seedStore();

      render(
        <MovieStoreProvider>
          <button type="button">Outside control</button>
          <RankedFeed />
        </MovieStoreProvider>
      );

      const outsideBtn = screen.getByRole('button', { name: 'Outside control' });
      const cardA = document.querySelector<HTMLDivElement>('div[data-movie-id="301"]')!;
      const rate8Btn = within(cardA).getByRole('radio', { name: /Rate 8 out of 10/i });
      fireEvent.click(rate8Btn);

      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.RATINGS) || '{}')[301]?.rating).toBe(8);

      act(() => {
        vi.advanceTimersByTime(4000);
      });

      const undoBtn = within(cardA).getByRole('button', {
        name: 'Undo rating for Candidate Film A',
      });
      act(() => {
        undoBtn.focus();
      });
      fireEvent.click(undoBtn);

      // Rating is removed
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.RATINGS) || '{}')[301]).toBeUndefined();
      expect(within(cardA).getByRole('radio', { name: /Rate 8 out of 10/i })).toHaveAttribute(
        'aria-checked',
        'false'
      );

      // Status strip is cleared and card stays
      expect(within(cardA).queryByText(/Rated 8\/10, moved to My Ratings/i)).toBeNull();
      expect(screen.getByText('Candidate Film A')).toBeInTheDocument();

      // Focus moves to the card's rating control
      const ratingGroup = within(cardA).getByRole('radiogroup', {
        name: /Movie rating from 1 to 10/i,
      });
      expect(ratingGroup.contains(document.activeElement)).toBe(true);

      // Moving focus outside the card after Undo does not restart dismissal
      act(() => {
        outsideBtn.focus();
      });
      expect(cardA.contains(document.activeElement)).toBe(false);

      // Removal timer was cancelled (stays past 8s and beyond)
      act(() => {
        vi.advanceTimersByTime(12000);
      });
      expect(screen.getByText('Candidate Film A')).toBeInTheDocument();
      expect(dismissSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('pauses while focus is inside the card past 8s, and dismisses 8s after focus leaves', () => {
    vi.useFakeTimers();
    try {
      seedStore();

      render(
        <MovieStoreProvider>
          <button type="button">Outside control</button>
          <RankedFeed />
        </MovieStoreProvider>
      );

      const outsideBtn = screen.getByRole('button', { name: 'Outside control' });
      const cardA = document.querySelector<HTMLDivElement>('div[data-movie-id="301"]')!;
      const rate8Btn = within(cardA).getByRole('radio', { name: /Rate 8 out of 10/i });

      // Focus inside card before/during rating
      act(() => {
        rate8Btn.focus();
      });
      fireEvent.click(rate8Btn);

      // Stays past 8s while focus remains on rating button
      act(() => {
        vi.advanceTimersByTime(10000);
      });
      expect(screen.getByText('Candidate Film A')).toBeInTheDocument();
      expect(dismissSpy).not.toHaveBeenCalled();

      // Moving focus to Undo within the same card keeps timer paused
      const undoBtn = within(cardA).getByRole('button', {
        name: 'Undo rating for Candidate Film A',
      });
      act(() => {
        undoBtn.focus();
      });
      act(() => {
        vi.advanceTimersByTime(10000);
      });
      expect(screen.getByText('Candidate Film A')).toBeInTheDocument();
      expect(dismissSpy).not.toHaveBeenCalled();

      // Moving focus outside the card starts the full 8s countdown
      act(() => {
        outsideBtn.focus();
      });
      act(() => {
        vi.advanceTimersByTime(7900);
      });
      expect(screen.getByText('Candidate Film A')).toBeInTheDocument();
      expect(dismissSpy).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(screen.queryByText('Candidate Film A')).toBeNull();
      expect(dismissSpy).toHaveBeenCalledTimes(1);
      expect(dismissSpy).toHaveBeenCalledWith(301);
    } finally {
      vi.useRealTimers();
    }
  });

  it('pauses when the pointer enters the card and restarts the full 8s timer when it leaves', () => {
    vi.useFakeTimers();
    try {
      seedStore();

      render(
        <MovieStoreProvider>
          <RankedFeed />
        </MovieStoreProvider>
      );

      const cardA = document.querySelector<HTMLDivElement>('div[data-movie-id="301"]')!;
      const rate8Btn = within(cardA).getByRole('radio', { name: /Rate 8 out of 10/i });
      fireEvent.click(rate8Btn);

      // Advance 5s into the 8s countdown, then move pointer into card
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      fireEvent.pointerEnter(cardA);

      // Stays well past the original 8s
      act(() => {
        vi.advanceTimersByTime(10000);
      });
      expect(screen.getByText('Candidate Film A')).toBeInTheDocument();
      expect(dismissSpy).not.toHaveBeenCalled();

      // Leaving restarts the full 8s (not just the remaining 3s)
      fireEvent.pointerLeave(cardA);
      act(() => {
        vi.advanceTimersByTime(7900);
      });
      expect(screen.getByText('Candidate Film A')).toBeInTheDocument();
      expect(dismissSpy).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(screen.queryByText('Candidate Film A')).toBeNull();
      expect(dismissSpy).toHaveBeenCalledTimes(1);
      expect(dismissSpy).toHaveBeenCalledWith(301);
    } finally {
      vi.useRealTimers();
    }
  });

  it('unmounting with a pending removal does not throw or call dismissRecommendation', () => {
    vi.useFakeTimers();
    try {
      seedStore();

      const { unmount } = render(
        <MovieStoreProvider>
          <RankedFeed />
        </MovieStoreProvider>
      );

      const cardA = document.querySelector<HTMLDivElement>('div[data-movie-id="301"]')!;
      const rate8Btn = within(cardA).getByRole('radio', { name: /Rate 8 out of 10/i });
      fireEvent.click(rate8Btn);

      expect(within(cardA).getByRole('status')).toHaveTextContent(
        'Rated 8/10, moved to My Ratings'
      );

      unmount();

      expect(() => {
        act(() => {
          vi.advanceTimersByTime(15000);
        });
      }).not.toThrow();

      expect(dismissSpy).not.toHaveBeenCalled();
      const storedCache = JSON.parse(
        localStorage.getItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS) || '{}'
      );
      expect(
        storedCache.recommendations?.some((r: { movie: { id: number } }) => r.movie.id === 301)
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-rating during the grace period updates the status strip and restarts the full 8s timer', () => {
    vi.useFakeTimers();
    try {
      seedStore();

      render(
        <MovieStoreProvider>
          <RankedFeed />
        </MovieStoreProvider>
      );

      const cardA = document.querySelector<HTMLDivElement>('div[data-movie-id="301"]')!;
      fireEvent.click(within(cardA).getByRole('radio', { name: /Rate 8 out of 10/i }));

      act(() => {
        vi.advanceTimersByTime(5000);
      });

      fireEvent.click(within(cardA).getByRole('radio', { name: /Rate 10 out of 10/i }));
      expect(within(cardA).getByRole('status')).toHaveTextContent(
        'Rated 10/10, moved to My Ratings'
      );

      // Past original 8s (5s + 7.9s), card stays because re-rating restarted the 8s grace timer
      act(() => {
        vi.advanceTimersByTime(7900);
      });
      expect(screen.getByText('Candidate Film A')).toBeInTheDocument();
      expect(dismissSpy).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(screen.queryByText('Candidate Film A')).toBeNull();
      expect(dismissSpy).toHaveBeenCalledTimes(1);
      expect(dismissSpy).toHaveBeenCalledWith(301);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays paused while either focus or pointer remains inside the card, then dismisses 8s after both leave', () => {
    vi.useFakeTimers();
    try {
      seedStore();

      render(
        <MovieStoreProvider>
          <button type="button">Outside control</button>
          <RankedFeed />
        </MovieStoreProvider>
      );

      const outsideBtn = screen.getByRole('button', { name: 'Outside control' });
      const cardA = document.querySelector<HTMLDivElement>('div[data-movie-id="301"]')!;
      const rate8Btn = within(cardA).getByRole('radio', { name: /Rate 8 out of 10/i });

      fireEvent.pointerEnter(cardA);
      act(() => {
        rate8Btn.focus();
      });
      fireEvent.click(rate8Btn);

      // Pointer leaves, but focus is still inside -> remains paused past 8s
      fireEvent.pointerLeave(cardA);
      act(() => {
        vi.advanceTimersByTime(10000);
      });
      expect(screen.getByText('Candidate Film A')).toBeInTheDocument();
      expect(dismissSpy).not.toHaveBeenCalled();

      // Focus leaves too -> full 8s countdown begins
      act(() => {
        outsideBtn.focus();
      });
      act(() => {
        vi.advanceTimersByTime(7900);
      });
      expect(screen.getByText('Candidate Film A')).toBeInTheDocument();
      expect(dismissSpy).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(screen.queryByText('Candidate Film A')).toBeNull();
      expect(dismissSpy).toHaveBeenCalledTimes(1);
      expect(dismissSpy).toHaveBeenCalledWith(301);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rating two cards and undoing the first keeps the first and dismisses only the second after 8s', () => {
    vi.useFakeTimers();
    try {
      seedStore();

      render(
        <MovieStoreProvider>
          <RankedFeed />
        </MovieStoreProvider>
      );

      const cardA = document.querySelector<HTMLDivElement>('div[data-movie-id="301"]')!;
      const cardB = document.querySelector<HTMLDivElement>('div[data-movie-id="302"]')!;

      fireEvent.click(within(cardA).getByRole('radio', { name: /Rate 8 out of 10/i }));
      fireEvent.click(within(cardB).getByRole('radio', { name: /Rate 9 out of 10/i }));

      fireEvent.click(
        within(cardA).getByRole('button', { name: 'Undo rating for Candidate Film A' })
      );

      act(() => {
        vi.advanceTimersByTime(8000);
      });

      expect(screen.getByText('Candidate Film A')).toBeInTheDocument();
      expect(screen.queryByText('Candidate Film B')).toBeNull();
      expect(dismissSpy).toHaveBeenCalledTimes(1);
      expect(dismissSpy).toHaveBeenCalledWith(302);
    } finally {
      vi.useRealTimers();
    }
  });
});
