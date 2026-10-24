import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CsvImportModal } from '../CsvImportModal';
import { MovieStoreProvider } from '../../store/useMovieStore';
import { credentialStore } from '../../services/credentialStore';
import * as tmdbService from '../../services/tmdb';
import { STORAGE_KEYS, safeGetItem, safeSetItem, clearInMemoryStoreForTesting } from '../../services/storage';

vi.mock('../../services/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/tmdb')>();
  return {
    ...actual,
    searchMovies: vi.fn(),
    findMovieByExternalId: vi.fn(),
  };
});

const renderModal = (onClose = vi.fn()) => {
  return render(
    <MovieStoreProvider>
      <CsvImportModal isOpen={true} onClose={onClose} />
    </MovieStoreProvider>
  );
};

describe('CsvImportModal Ambiguity & Resolution', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    vi.clearAllMocks();
    credentialStore.setTmdbCredential('api_key', 'test-key');
  });

  afterEach(() => {
    clearInMemoryStoreForTesting();
    vi.restoreAllMocks();
  });

  it('leaves no-year film unresolved when multiple candidates share the exact title', async () => {
    // TMDB returns two movies with the exact same title ("Dune" 1984 and "Dune" 2021)
    vi.mocked(tmdbService.searchMovies).mockResolvedValueOnce({
      movies: [
        {
          id: 841,
          title: 'Dune',
          overview: '1984 version',
          release_date: '1984-12-14',
          vote_average: 6.5,
          vote_count: 2000,
          poster_path: null,
          backdrop_path: null,
          genres: [{ id: 878, name: 'Sci-Fi' }],
        },
        {
          id: 438631,
          title: 'Dune',
          overview: '2021 version',
          release_date: '2021-09-15',
          vote_average: 8.0,
          vote_count: 8000,
          poster_path: null,
          backdrop_path: null,
          genres: [{ id: 878, name: 'Sci-Fi' }],
        },
      ],
      totalPages: 1,
    });

    renderModal();

    // Upload a CSV with no year specified
    const csvContent = 'Title,Rating\nDune,8';
    const file = new File([csvContent], 'ratings.csv', { type: 'text/csv' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    // Wait for "Start Import" button
    const startButton = await screen.findByRole('button', { name: /Start Import/i });
    fireEvent.click(startButton);

    // Because there are multiple exact matches with no year, it must be reported as unresolved
    await waitFor(() => {
      expect(screen.getByText(/could not be matched/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Ambiguous or unverified TMDB title match/i).length).toBeGreaterThan(0);
    });
  });

  it('matches no-year film when exactly one exact match exists', async () => {
    vi.mocked(tmdbService.searchMovies).mockResolvedValueOnce({
      movies: [
        {
          id: 157336,
          title: 'Interstellar',
          overview: 'Single exact match',
          release_date: '2014-11-05',
          vote_average: 8.6,
          vote_count: 30000,
          poster_path: null,
          backdrop_path: null,
          genres: [{ id: 878, name: 'Sci-Fi' }],
        },
      ],
      totalPages: 1,
    });

    renderModal();

    const csvContent = 'Title,Rating\nInterstellar,10';
    const file = new File([csvContent], 'ratings.csv', { type: 'text/csv' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    const startButton = await screen.findByRole('button', { name: /Start Import/i });
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(screen.getByText(/1 film\(s\) verified and ready/i)).toBeInTheDocument();
    });
  });

  it('disambiguates between identical titles when year is provided', async () => {
    vi.mocked(tmdbService.searchMovies).mockResolvedValueOnce({
      movies: [
        {
          id: 841,
          title: 'Dune',
          overview: '1984 version',
          release_date: '1984-12-14',
          vote_average: 6.5,
          vote_count: 2000,
          poster_path: null,
          backdrop_path: null,
          genres: [{ id: 878, name: 'Sci-Fi' }],
        },
        {
          id: 438631,
          title: 'Dune',
          overview: '2021 version',
          release_date: '2021-09-15',
          vote_average: 8.0,
          vote_count: 8000,
          poster_path: null,
          backdrop_path: null,
          genres: [{ id: 878, name: 'Sci-Fi' }],
        },
      ],
      totalPages: 1,
    });

    renderModal();

    const csvContent = 'Title,Year,Rating\nDune,2021,9';
    const file = new File([csvContent], 'ratings.csv', { type: 'text/csv' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    const startButton = await screen.findByRole('button', { name: /Start Import/i });
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(screen.getByText(/1 film\(s\) verified and ready/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Dune \(2021\)/i).length).toBeGreaterThan(0);
    });
  });

  it('stores imported Letterboxd ratedAt rather than current Date.now()', async () => {
    const fixedNow = 1790000000000;
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(fixedNow);

    vi.mocked(tmdbService.searchMovies).mockResolvedValueOnce({
      movies: [
        {
          id: 438631,
          title: 'Dune',
          overview: '2021 version',
          release_date: '2021-09-15',
          vote_average: 8.0,
          vote_count: 8000,
          poster_path: null,
          backdrop_path: null,
          genres: [{ id: 878, name: 'Sci-Fi' }],
        },
      ],
      totalPages: 1,
    });

    renderModal();

    const csvContent = 'Date,Name,Year,Letterboxd URI,Rating\n2022-03-15,Dune,2021,https://boxd.it/test,4.5';
    const file = new File([csvContent], 'ratings.csv', { type: 'text/csv' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    const startButton = await screen.findByRole('button', { name: /Start Import/i });
    fireEvent.click(startButton);

    const confirmButton = await screen.findByRole('button', { name: /Confirm Import/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      const storedStr = safeGetItem(STORAGE_KEYS.RATINGS);
      expect(storedStr).not.toBeNull();
      const stored = JSON.parse(storedStr!);
      expect(stored[438631]).toBeDefined();
      expect(stored[438631].ratedAt).toBe(Date.UTC(2022, 2, 15));
      expect(stored[438631].ratedAt).not.toBe(fixedNow);
    });

    dateSpy.mockRestore();
  });

  it('falls back to Date.now() when imported Letterboxd row has no date', async () => {
    const fixedNow = 1790000000000;
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(fixedNow);

    vi.mocked(tmdbService.searchMovies).mockResolvedValueOnce({
      movies: [
        {
          id: 438631,
          title: 'Dune',
          overview: '2021 version',
          release_date: '2021-09-15',
          vote_average: 8.0,
          vote_count: 8000,
          poster_path: null,
          backdrop_path: null,
          genres: [{ id: 878, name: 'Sci-Fi' }],
        },
      ],
      totalPages: 1,
    });

    renderModal();

    const csvContent = 'Name,Year,Rating\nDune,2021,4.5';
    const file = new File([csvContent], 'ratings.csv', { type: 'text/csv' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    const startButton = await screen.findByRole('button', { name: /Start Import/i });
    fireEvent.click(startButton);

    const confirmButton = await screen.findByRole('button', { name: /Confirm Import/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      const storedStr = safeGetItem(STORAGE_KEYS.RATINGS);
      expect(storedStr).not.toBeNull();
      const stored = JSON.parse(storedStr!);
      expect(stored[438631]).toBeDefined();
      expect(stored[438631].ratedAt).toBe(fixedNow);
    });

    dateSpy.mockRestore();
  });

  it('stores imported Letterboxd ratedAt from Watched Date when both Date and Watched Date are present', async () => {
    const fixedNow = 1790000000000;
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(fixedNow);

    vi.mocked(tmdbService.searchMovies).mockResolvedValueOnce({
      movies: [
        {
          id: 438631,
          title: 'Dune',
          overview: '2021 version',
          release_date: '2021-09-15',
          vote_average: 8.0,
          vote_count: 8000,
          poster_path: null,
          backdrop_path: null,
          genres: [{ id: 878, name: 'Sci-Fi' }],
        },
      ],
      totalPages: 1,
    });

    renderModal();

    const csvContent =
      'Date,Name,Year,Letterboxd URI,Rating,Watched Date\n2022-01-01,Dune,2021,https://boxd.it/test,4.5,2022-05-20';
    const file = new File([csvContent], 'ratings.csv', { type: 'text/csv' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    const startButton = await screen.findByRole('button', { name: /Start Import/i });
    fireEvent.click(startButton);

    const confirmButton = await screen.findByRole('button', { name: /Confirm Import/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      const storedStr = safeGetItem(STORAGE_KEYS.RATINGS);
      expect(storedStr).not.toBeNull();
      const stored = JSON.parse(storedStr!);
      expect(stored[438631]).toBeDefined();
      expect(stored[438631].ratedAt).toBe(Date.UTC(2022, 4, 20));
      expect(stored[438631].ratedAt).not.toBe(Date.UTC(2022, 0, 1));
      expect(stored[438631].ratedAt).not.toBe(fixedNow);
    });

    dateSpy.mockRestore();
  });

  it('stores imported CineMatch export ratedAt from Rated_At without falling back to Date.now()', async () => {
    const fixedNow = 1790000000000;
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(fixedNow);

    renderModal();

    const fixedPastTime = 1672531199000; // 2022-12-31T23:59:59.000Z
    const csvContent = `Title,Year,Rating,Genres,Director,TMDB_ID,Rated_At\nInception,2010,10,Action,Christopher Nolan,27205,2022-12-31T23:59:59.000Z`;
    const file = new File([csvContent], 'ratings.csv', { type: 'text/csv' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    const startButton = await screen.findByRole('button', { name: /Start Import/i });
    fireEvent.click(startButton);

    const confirmButton = await screen.findByRole('button', { name: /Confirm Import/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      const storedStr = safeGetItem(STORAGE_KEYS.RATINGS);
      expect(storedStr).not.toBeNull();
      const stored = JSON.parse(storedStr!);
      expect(stored[27205]).toBeDefined();
      expect(stored[27205].ratedAt).toBe(fixedPastTime);
      expect(stored[27205].ratedAt).not.toBe(fixedNow);
    });

    dateSpy.mockRestore();
  });

  it('imports watched.csv: shows "1 film marked as seen" and calls hideFilms with one entry', async () => {
    // 1. Seed existing rating in storage before mounting the store provider
    const existingRatings = {
      100: {
        movieId: 100,
        title: 'Rated Film',
        rating: 8,
        posterPath: null,
        year: '1995',
        genres: ['Drama'],
        ratedAt: 1_600_000_000_000,
      },
    };
    safeSetItem(STORAGE_KEYS.RATINGS, JSON.stringify(existingRatings));

    // 2. Setup TMDB mock:
    // - 'Rated Film' -> resolves to ID 100 (matches existing rating -> skippedRated)
    // - 'New Film' -> resolves to ID 200 (unrated, unhidden -> toHide)
    // - 'Unresolvable Film' -> resolves to no candidates -> unresolved
    vi.mocked(tmdbService.searchMovies).mockImplementation(async (query) => {
      if (query === 'Rated Film') {
        return {
          movies: [
            {
              id: 100,
              title: 'Rated Film',
              overview: '',
              release_date: '1995-05-10',
              vote_average: 8.0,
              vote_count: 1000,
              poster_path: null,
              backdrop_path: null,
              genres: [],
            },
          ],
          totalPages: 1,
        };
      }
      if (query === 'New Film') {
        return {
          movies: [
            {
              id: 200,
              title: 'New Film',
              overview: '',
              release_date: '2000-08-15',
              vote_average: 7.5,
              vote_count: 500,
              poster_path: null,
              backdrop_path: null,
              genres: [],
            },
          ],
          totalPages: 1,
        };
      }
      return { movies: [], totalPages: 0 };
    });

    renderModal();

    // 3. Select watched.csv with 3 rows (one rated, one new, one unresolvable)
    const csvContent =
      'Date,Name,Year,Letterboxd URI\n' +
      '2021-01-01,Rated Film,1995,https://boxd.it/rated\n' +
      '2021-02-02,New Film,2000,https://boxd.it/new\n' +
      '2021-03-03,Unresolvable Film,2010,https://boxd.it/mystery\n';
    const file = new File([csvContent], 'watched.csv', { type: 'text/csv' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    // Wait for "Start Import" button and click it
    const startButton = await screen.findByRole('button', { name: /Start Import/i });
    fireEvent.click(startButton);

    // 4. Assert UI shows "1 film marked as seen" and counts in result area
    expect(await screen.findByText(/1 film marked as seen/i)).toBeInTheDocument();
    expect(screen.getByText(/Import complete: 1 film marked as seen, 1 skipped, 1 unresolved, 0 dropped\./i)).toBeInTheDocument();

    // 5. Assert hideFilms was called with one entry and persisted
    await waitFor(() => {
      const storedStr = safeGetItem(STORAGE_KEYS.HIDDEN_FILMS);
      expect(storedStr).not.toBeNull();
      const stored = JSON.parse(storedStr!);
      expect(stored).toHaveLength(1);
      expect(stored[0].movieId).toBe(200);
      expect(stored[0].reason).toBe('seen');
      expect(stored[0].title).toBe('New Film');
      expect(stored[0].hiddenAt).toBe(Date.UTC(2021, 1, 2));
    });
  });

  it('does not cancel import when backdrop is clicked during resolution', async () => {
    let resolveSearch: (value: any) => void;
    const searchPromise = new Promise((res) => {
      resolveSearch = res;
    });

    vi.mocked(tmdbService.searchMovies).mockImplementationOnce(() => searchPromise as any);

    const onClose = vi.fn();
    renderModal(onClose);

    const csvContent = 'Date,Name,Year,Letterboxd URI\n2021-02-02,New Film,2000,https://boxd.it/new\n';
    const file = new File([csvContent], 'watched.csv', { type: 'text/csv' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    const startButton = await screen.findByRole('button', { name: /Start Import/i });
    fireEvent.click(startButton);

    // Click the backdrop container while import is resolving
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.parentElement!;
    fireEvent.click(backdrop);

    // Modal must not close and import must not cancel
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/Matching\.\.\./i)).toBeInTheDocument();

    // Complete the TMDB lookup
    resolveSearch!({
      movies: [
        {
          id: 200,
          title: 'New Film',
          overview: '',
          release_date: '2000-08-15',
          vote_average: 7.5,
          vote_count: 500,
          poster_path: null,
          backdrop_path: null,
          genres: [],
        },
      ],
      totalPages: 1,
    });

    expect(await screen.findByText(/1 film marked as seen/i)).toBeInTheDocument();
    const stored = JSON.parse(safeGetItem(STORAGE_KEYS.HIDDEN_FILMS)!);
    expect(stored).toHaveLength(1);
    expect(stored[0].movieId).toBe(200);
  });

  it('leaves no partial hide when import is cancelled mid-resolution', async () => {
    let resolveSearch: (value: any) => void;
    const searchPromise = new Promise((res) => {
      resolveSearch = res;
    });

    vi.mocked(tmdbService.searchMovies).mockImplementationOnce(() => searchPromise as any);

    const onClose = vi.fn();
    renderModal(onClose);

    const csvContent =
      'Date,Name,Year,Letterboxd URI\n' +
      '2021-02-02,Film 1,2000,https://boxd.it/f1\n' +
      '2021-02-03,Film 2,2001,https://boxd.it/f2\n';
    const file = new File([csvContent], 'watched.csv', { type: 'text/csv' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    const startButton = await screen.findByRole('button', { name: /Start Import/i });
    fireEvent.click(startButton);

    expect(screen.getByText(/Matching\.\.\./i)).toBeInTheDocument();

    // User cancels import mid-flight
    const cancelButton = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelButton);
    expect(onClose).toHaveBeenCalled();

    // TMDB resolves after cancellation
    resolveSearch!({
      movies: [
        {
          id: 200,
          title: 'Film 1',
          overview: '',
          release_date: '2000-08-15',
          vote_average: 7.5,
          vote_count: 500,
          poster_path: null,
          backdrop_path: null,
          genres: [],
        },
      ],
      totalPages: 1,
    });

    // Verify no partial hide was committed
    const storedStr = safeGetItem(STORAGE_KEYS.HIDDEN_FILMS);
    expect(storedStr).toBeNull();
  });
});
