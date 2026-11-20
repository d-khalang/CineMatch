import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import { RankedFeed } from '../RankedFeed';
import { Toast } from '../Toast';
import { MovieStoreProvider, useMovieStore } from '../../store/useMovieStore';
import { STORAGE_KEYS, clearInMemoryStoreForTesting } from '../../services/storage';
import { aiManager } from '../../services/ai/aiManager';

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

const cachedThreeRecs = {
  recommendations: [
    {
      movie: {
        id: 301,
        title: 'Candidate Film A',
        overview: 'First recommended film',
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
        overview: 'Second recommended film',
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
    {
      movie: {
        id: 303,
        title: 'Candidate Film C',
        overview: 'Third recommended film',
        release_date: '2023-03-10',
        vote_average: 7.4,
        vote_count: 650,
        poster_path: null,
        backdrop_path: null,
        genres: [{ id: 35, name: 'Comedy' }],
      },
      score: 86,
      rank: 3,
      reason: 'Recommended comedy match',
      serendipityType: 'safe_bet',
      highlightTags: [],
    },
  ],
  generatedAt: 100000,
  usedProvider: 'gemini',
  settingsFingerprint: 'fingerprint-123',
  ratedCount: 2,
};

function getCardOrder(): string[] {
  return screen
    .getAllByRole('button', { name: /^Seen it:/ })
    .map((btn) => btn.getAttribute('aria-label') || '');
}

function getToastLiveRegion(): HTMLElement {
  return within(screen.getByTestId('toast-host')).getByRole('status');
}

describe('CIN-62: "Seen it" inline rating & Undo on hide toast', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    vi.clearAllMocks();
  });

  it('clicking "Seen it" opens inline prompt with existing RatingControl and Skip, keeps card visible, and moves focus into rating control', () => {
    localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedThreeRecs));

    render(
      <MovieStoreProvider>
        <RankedFeed />
        <Toast />
      </MovieStoreProvider>
    );

    const seenBtnA = screen.getByRole('button', { name: 'Seen it: Candidate Film A' });
    expect(seenBtnA).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(seenBtnA);

    // Card is NOT hidden immediately
    expect(screen.getByText('Candidate Film A')).toBeInTheDocument();
    expect(seenBtnA).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.HIDDEN_FILMS) || '[]')).toEqual([]);

    // Reuses the card's existing RatingControl (still 3 radiogroups total for 3 cards)
    const radiogroups = screen.getAllByRole('radiogroup', { name: 'Movie rating from 1 to 10' });
    expect(radiogroups).toHaveLength(3);

    // Focus moves into the first card's rating control
    expect(radiogroups[0].contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.getAttribute('role')).toBe('radio');
  });

  it('rating inside the "Seen it" prompt uses the existing rate-and-dismiss path', () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));
      localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedThreeRecs));

      render(
        <MovieStoreProvider>
          <RankedFeed />
          <Toast />
        </MovieStoreProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Seen it: Candidate Film A' }));
      expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();

      // Rate Film A 9/10
      const rate9Btn = screen.getAllByRole('radio', { name: /Rate 9 out of 10/i })[0];
      fireEvent.click(rate9Btn);

      // Prompt closes, rating is saved, grace banner and toast appear
      expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
      expect(screen.getByText(/Rated 9\/10, moved to My Ratings/i)).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Undo rating for Candidate Film A' })
      ).toBeInTheDocument();
      expect(
        screen.getByText('Rated "Candidate Film A" 9/10 — saved to My Ratings!')
      ).toBeInTheDocument();

      const storedRatings = JSON.parse(localStorage.getItem(STORAGE_KEYS.RATINGS) || '{}');
      expect(storedRatings[301]?.rating).toBe(9);

      // Move focus out of the card so the 8000ms grace period starts (CIN-52 pauses dismissal while focused)
      const heading = screen.getByRole('heading', { level: 1, name: /Top Ranked Movies for You/i });
      act(() => {
        heading.focus();
      });
      expect(document.activeElement).toBe(heading);

      // Still visible just before the 8000ms grace period ends
      act(() => {
        vi.advanceTimersByTime(7900);
      });
      expect(screen.getByText('Candidate Film A')).toBeInTheDocument();

      // Dismisses after 8000ms grace period and is NOT placed in hiddenFilms
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(screen.queryByText('Candidate Film A')).toBeNull();
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.HIDDEN_FILMS) || '[]')).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Escape and second click on "Seen it" both close the prompt without hiding', () => {
    localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedThreeRecs));

    render(
      <MovieStoreProvider>
        <RankedFeed />
        <Toast />
      </MovieStoreProvider>
    );

    const seenBtnA = screen.getByRole('button', { name: 'Seen it: Candidate Film A' });

    // Open prompt -> Escape closes it without hiding and returns focus to "Seen it"
    fireEvent.click(seenBtnA);
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();

    fireEvent.keyDown(document.activeElement || document, { key: 'Escape' });

    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
    expect(seenBtnA).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Candidate Film A')).toBeInTheDocument();
    expect(document.activeElement).toBe(seenBtnA);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.HIDDEN_FILMS) || '[]')).toEqual([]);

    // Open prompt -> second click on "Seen it" closes it without hiding
    fireEvent.click(seenBtnA);
    expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument();

    fireEvent.click(seenBtnA);
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
    expect(seenBtnA).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Candidate Film A')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.HIDDEN_FILMS) || '[]')).toEqual([]);
  });

  it('Skip hides with reason "seen", moves focus per pendingFocusRef, and Undo restores card at its old position and focuses its "Seen it" button', () => {
    localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedThreeRecs));

    let storeCapture: ReturnType<typeof useMovieStore> | null = null;
    const StoreSpy = () => {
      storeCapture = useMovieStore();
      return null;
    };

    render(
      <MovieStoreProvider>
        <StoreSpy />
        <RankedFeed />
        <div data-testid="toast-host">
          <Toast />
        </div>
      </MovieStoreProvider>
    );

    expect(getCardOrder()).toEqual([
      'Seen it: Candidate Film A',
      'Seen it: Candidate Film B',
      'Seen it: Candidate Film C',
    ]);

    // Open prompt on middle card (B) and click Skip
    fireEvent.click(screen.getByRole('button', { name: 'Seen it: Candidate Film B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    // Card B is hidden with reason 'seen'
    expect(screen.queryByText('Candidate Film B')).toBeNull();
    expect(getCardOrder()).toEqual([
      'Seen it: Candidate Film A',
      'Seen it: Candidate Film C',
    ]);
    expect(storeCapture!.hiddenFilms).toEqual([
      expect.objectContaining({ movieId: 302, reason: 'seen', title: 'Candidate Film B' }),
    ]);

    // Focus moved to next card's "Seen it" button (Film C)
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Seen it: Candidate Film C' })
    );

    // Toast shows Undo inside role="status" live region
    const liveRegion = getToastLiveRegion();
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(liveRegion).toHaveTextContent(
      'Hidden "Candidate Film B". Restore it in Settings → Hidden films.'
    );
    const undoBtn = within(liveRegion).getByRole('button', { name: 'Undo' });
    expect(undoBtn).toBeInTheDocument();

    // Click Undo
    fireEvent.click(undoBtn);

    // Toast is cleared, restoreFilm removed movieId 302 from hiddenFilms, card B is back at #2
    expect(getToastLiveRegion()).toHaveTextContent('');
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(storeCapture!.hiddenFilms).toEqual([]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.HIDDEN_FILMS) || '[]')).toEqual([]);
    expect(getCardOrder()).toEqual([
      'Seen it: Candidate Film A',
      'Seen it: Candidate Film B',
      'Seen it: Candidate Film C',
    ]);

    // Focus goes to the restored card's "Seen it" button
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Seen it: Candidate Film B' })
    );
  });

  it('Not for me shows Undo toast and Undo restores the card at its old position and focuses its "Seen it" button', () => {
    localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedThreeRecs));

    render(
      <MovieStoreProvider>
        <RankedFeed />
        <div data-testid="toast-host">
          <Toast />
        </div>
      </MovieStoreProvider>
    );

    // Hide first card (Film A) via "Not for me"
    fireEvent.click(screen.getByRole('button', { name: 'Not for me: Candidate Film A' }));

    expect(screen.queryByText('Candidate Film A')).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Seen it: Candidate Film B' })
    );

    const undoBtn = screen.getByRole('button', { name: 'Undo' });
    fireEvent.click(undoBtn);

    // Restored at rank #1 (first position) and focused
    expect(getCardOrder()).toEqual([
      'Seen it: Candidate Film A',
      'Seen it: Candidate Film B',
      'Seen it: Candidate Film C',
    ]);
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Seen it: Candidate Film A' })
    );
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.HIDDEN_FILMS) || '[]')).toEqual([]);
    expect(getToastLiveRegion()).toHaveTextContent('');
  });

  it('keeps restored card in its relative position even if another card is later hidden', () => {
    localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedThreeRecs));

    render(
      <MovieStoreProvider>
        <RankedFeed />
        <Toast />
      </MovieStoreProvider>
    );

    // Hide B (index 1) -> Undo B -> Hide A (index 0)
    fireEvent.click(screen.getByRole('button', { name: 'Not for me: Candidate Film B' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Not for me: Candidate Film A' }));

    // B must remain before C
    expect(getCardOrder()).toEqual([
      'Seen it: Candidate Film B',
      'Seen it: Candidate Film C',
    ]);
  });

  it('hiding the last/only card and clicking Undo brings it back without triggering auto-generation', () => {
    localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));
    const singleRec = {
      ...cachedThreeRecs,
      recommendations: [cachedThreeRecs.recommendations[0]],
    };
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(singleRec));

    render(
      <MovieStoreProvider>
        <RankedFeed />
        <Toast />
      </MovieStoreProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Not for me: Candidate Film A' }));
    expect(screen.queryByText('Candidate Film A')).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { level: 1, name: /Top Ranked Movies for You/i })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(screen.getByText('Candidate Film A')).toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Seen it: Candidate Film A' })
    );
    expect(aiManager.generateRecommendations).not.toHaveBeenCalled();
  });

  it('Undo toast stays visible for ~8 seconds and auto-clears after 8000ms', () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));
      localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedThreeRecs));

      render(
        <MovieStoreProvider>
          <RankedFeed />
          <div data-testid="toast-host">
            <Toast />
          </div>
        </MovieStoreProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Not for me: Candidate Film A' }));

      const liveRegion = getToastLiveRegion();
      expect(liveRegion).toHaveTextContent('Hidden "Candidate Film A"');
      expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();

      // Still visible right before 8 seconds
      act(() => {
        vi.advanceTimersByTime(7900);
      });
      expect(liveRegion).toHaveTextContent('Hidden "Candidate Film A"');
      expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();

      // Clears at 8000ms
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(liveRegion).toHaveTextContent('');
      expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('plain toast without an action keeps role="status"/aria-live, has no action button, and clears after 3000ms', () => {
    vi.useFakeTimers();
    try {
      const PlainToastTrigger: React.FC = () => {
        const { showToast } = useMovieStore();
        return (
          <div>
            <Toast />
            <button type="button" onClick={() => showToast('Plain notification')}>
              Show Plain Toast
            </button>
          </div>
        );
      };

      render(
        <MovieStoreProvider>
          <PlainToastTrigger />
        </MovieStoreProvider>
      );

      const liveRegion = screen.getByRole('status');
      expect(liveRegion).toHaveAttribute('aria-live', 'polite');

      fireEvent.click(screen.getByRole('button', { name: 'Show Plain Toast' }));

      expect(liveRegion).toHaveTextContent('Plain notification');
      const toastButtons = within(liveRegion).getAllByRole('button');
      expect(toastButtons).toHaveLength(1);
      expect(toastButtons[0]).toHaveAttribute('aria-label', 'Dismiss notification');

      act(() => {
        vi.advanceTimersByTime(2900);
      });
      expect(liveRegion).toHaveTextContent('Plain notification');

      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(liveRegion).toHaveTextContent('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('opening "Seen it" on another card targets that card rating control and switches cleanly between cards', () => {
    localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedThreeRecs));

    render(
      <MovieStoreProvider>
        <RankedFeed />
        <Toast />
      </MovieStoreProvider>
    );

    const seenBtnA = screen.getByRole('button', { name: 'Seen it: Candidate Film A' });
    const seenBtnB = screen.getByRole('button', { name: 'Seen it: Candidate Film B' });
    const radiogroups = screen.getAllByRole('radiogroup', { name: 'Movie rating from 1 to 10' });

    fireEvent.click(seenBtnB);
    expect(seenBtnB).toHaveAttribute('aria-expanded', 'true');
    expect(seenBtnA).toHaveAttribute('aria-expanded', 'false');
    expect(radiogroups[1].contains(document.activeElement)).toBe(true);
    expect(screen.getAllByRole('button', { name: 'Skip' })).toHaveLength(1);

    fireEvent.click(seenBtnA);
    expect(seenBtnA).toHaveAttribute('aria-expanded', 'true');
    expect(seenBtnB).toHaveAttribute('aria-expanded', 'false');
    expect(radiogroups[0].contains(document.activeElement)).toBe(true);
    expect(screen.getAllByRole('button', { name: 'Skip' })).toHaveLength(1);
  });

  it('hiding the last card in a multi-card list focuses the previous card and Undo restores it at the last position', () => {
    localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));
    localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(cachedThreeRecs));

    render(
      <MovieStoreProvider>
        <RankedFeed />
        <Toast />
      </MovieStoreProvider>
    );

    // Hide last card (Film C) via Seen it -> Skip
    fireEvent.click(screen.getByRole('button', { name: 'Seen it: Candidate Film C' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    expect(getCardOrder()).toEqual([
      'Seen it: Candidate Film A',
      'Seen it: Candidate Film B',
    ]);
    // Focus moves to previous card (Film B)
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Seen it: Candidate Film B' })
    );

    // Undo restores Film C at rank #3 (last position) and focuses its Seen it button
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(getCardOrder()).toEqual([
      'Seen it: Candidate Film A',
      'Seen it: Candidate Film B',
      'Seen it: Candidate Film C',
    ]);
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Seen it: Candidate Film C' })
    );
  });

  it('rating a restored last/only card keeps the 8s grace period without prematurely auto-generating', () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(STORAGE_KEYS.RATINGS, JSON.stringify(seededRatings));
      const singleRec = {
        ...cachedThreeRecs,
        recommendations: [cachedThreeRecs.recommendations[0]],
      };
      localStorage.setItem(STORAGE_KEYS.CACHED_RECOMMENDATIONS, JSON.stringify(singleRec));

      render(
        <MovieStoreProvider>
          <RankedFeed />
          <Toast />
        </MovieStoreProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: 'Not for me: Candidate Film A' }));
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

      // Open "Seen it" and rate the restored card 9/10
      fireEvent.click(screen.getByRole('button', { name: 'Seen it: Candidate Film A' }));
      fireEvent.click(screen.getByRole('radio', { name: /Rate 9 out of 10/i }));

      expect(screen.getByText(/Rated 9\/10, moved to My Ratings/i)).toBeInTheDocument();
      expect(aiManager.generateRecommendations).not.toHaveBeenCalled();

      // Move focus out of the card so the 8s grace timer runs, and verify it stays visible before 8000ms
      const heading = screen.getByRole('heading', { level: 1, name: /Top Ranked Movies for You/i });
      act(() => {
        heading.focus();
      });
      expect(document.activeElement).toBe(heading);

      act(() => {
        vi.advanceTimersByTime(7900);
      });
      expect(screen.getByText(/Rated 9\/10, moved to My Ratings/i)).toBeInTheDocument();
      expect(aiManager.generateRecommendations).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
