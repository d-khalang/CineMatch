import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CsvImportModal } from '../CsvImportModal';
import { MovieStoreProvider } from '../../store/useMovieStore';
import { credentialStore } from '../../services/credentialStore';
import * as tmdbService from '../../services/tmdb';
import { STORAGE_KEYS, safeGetItem, safeSetItem, clearInMemoryStoreForTesting } from '../../services/storage';

const { generateRankingsSpy } = vi.hoisted(() => ({
  generateRankingsSpy: vi.fn(),
}));

vi.mock('../../store/useMovieStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/useMovieStore')>();
  return {
    ...actual,
    useMovieStore: () => {
      const store = actual.useMovieStore();
      return {
        ...store,
        generateRankings: () => {
          generateRankingsSpy();
          return Promise.resolve();
        },
      };
    },
  };
});

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

  it('shows a plain "Done" after a watched import that closes the modal without calling generateRankings', async () => {
    vi.mocked(tmdbService.searchMovies).mockResolvedValueOnce({
      movies: [
        {
          id: 200,
          title: 'Heat',
          overview: '',
          release_date: '1995-12-15',
          vote_average: 8.2,
          vote_count: 5000,
          poster_path: null,
          backdrop_path: null,
          genres: [],
        },
      ],
      totalPages: 1,
    });

    const onClose = vi.fn();
    const Host = () => {
      const [open, setOpen] = React.useState(false);
      return (
        <MovieStoreProvider>
          <button type="button" onClick={() => setOpen(true)}>
            Open CSV Import
          </button>
          <CsvImportModal
            isOpen={open}
            onClose={() => {
              onClose();
              setOpen(false);
            }}
          />
        </MovieStoreProvider>
      );
    };

    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Open CSV Import' });
    opener.focus();
    fireEvent.click(opener);

    const csvContent = 'Date,Name,Year,Letterboxd URI\n2021-03-04,Heat,1995,https://boxd.it/abc\n';
    const file = new File([csvContent], 'watched.csv', { type: 'text/csv' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    const startButton = await screen.findByRole('button', { name: /Start Import/i });
    fireEvent.click(startButton);

    expect(await screen.findByText(/1 film marked as seen/i)).toBeInTheDocument();

    const doneButton = screen.getByRole('button', { name: 'Done' });
    expect(doneButton).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Recalibrate/i })).not.toBeInTheDocument();

    fireEvent.click(doneButton);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(generateRankingsSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener);
  });

  it('still shows "Done — Recalibrate AI Recommendations" after a ratings import and calls generateRankings', async () => {
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

    const onClose = vi.fn();
    renderModal(onClose);

    const csvContent = 'Date,Name,Year,Letterboxd URI,Rating\n2022-03-15,Dune,2021,https://boxd.it/test,4.5';
    const file = new File([csvContent], 'ratings.csv', { type: 'text/csv' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    const startButton = await screen.findByRole('button', { name: /Start Import/i });
    fireEvent.click(startButton);

    const confirmButton = await screen.findByRole('button', { name: /Confirm Import/i });
    fireEvent.click(confirmButton);

    const recalibrateButton = await screen.findByRole('button', {
      name: /Done — Recalibrate AI Recommendations/i,
    });
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();

    fireEvent.click(recalibrateButton);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(generateRankingsSpy).toHaveBeenCalledTimes(1);
  });

  it('shows plain "Done" without recalibrating even when a watched import hides 0 new films', async () => {
    safeSetItem(
      STORAGE_KEYS.RATINGS,
      JSON.stringify({
        200: {
          movieId: 200,
          title: 'Heat',
          rating: 9,
          posterPath: null,
          year: '1995',
          genres: ['Crime'],
          ratedAt: 1_600_000_000_000,
        },
      })
    );

    vi.mocked(tmdbService.searchMovies).mockResolvedValueOnce({
      movies: [
        {
          id: 200,
          title: 'Heat',
          overview: '',
          release_date: '1995-12-15',
          vote_average: 8.2,
          vote_count: 5000,
          poster_path: null,
          backdrop_path: null,
          genres: [],
        },
      ],
      totalPages: 1,
    });

    const onClose = vi.fn();
    renderModal(onClose);

    const csvContent = 'Date,Name,Year,Letterboxd URI\n2021-03-04,Heat,1995,https://boxd.it/abc\n';
    const file = new File([csvContent], 'watched.csv', { type: 'text/csv' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    const startButton = await screen.findByRole('button', { name: /Start Import/i });
    fireEvent.click(startButton);

    expect(await screen.findByText(/0 films marked as seen/i)).toBeInTheDocument();

    const doneButton = screen.getByRole('button', { name: 'Done' });
    expect(screen.queryByRole('button', { name: /Recalibrate/i })).not.toBeInTheDocument();

    fireEvent.click(doneButton);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(generateRankingsSpy).not.toHaveBeenCalled();
  });

  it('still shows recalibrate button and calls generateRankings for non-Letterboxd CSV in Replace mode', async () => {
    const onClose = vi.fn();
    renderModal(onClose);

    const csvContent = 'Title,Year,Rating,TMDB_ID\nInception,2010,10,27205';
    const file = new File([csvContent], 'cinematch_export.csv', { type: 'text/csv' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file] } });

    const startButton = await screen.findByRole('button', { name: /Start Import/i });
    fireEvent.click(screen.getByRole('button', { name: /Replace all currently stored ratings/i }));
    fireEvent.click(startButton);

    const confirmButton = await screen.findByRole('button', { name: /Confirm Import/i });
    fireEvent.click(confirmButton);

    const recalibrateButton = await screen.findByRole('button', {
      name: /Done — Recalibrate AI Recommendations/i,
    });
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();

    fireEvent.click(recalibrateButton);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(generateRankingsSpy).toHaveBeenCalledTimes(1);
  });

  it('ignores a stale file.text() read when another file is selected before it finishes', async () => {
    const onClose = vi.fn();
    renderModal(onClose);

    let resolveSlowWatchedText!: (text: string) => void;
    const slowWatchedFile = new File(['placeholder'], 'watched.csv', { type: 'text/csv' });
    vi.spyOn(slowWatchedFile, 'text').mockImplementationOnce(
      () =>
        new Promise<string>((res) => {
          resolveSlowWatchedText = res;
        })
    );

    const fastRatingsCsv = 'Title,Year,Rating,TMDB_ID\nInception,2010,10,27205';
    const fastRatingsFile = new File([fastRatingsCsv], 'ratings.csv', { type: 'text/csv' });

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [slowWatchedFile] } });
    fireEvent.change(input, { target: { files: [fastRatingsFile] } });

    const startButton = await screen.findByRole('button', { name: /Start Import \(1 Films\)/i });

    await act(async () => {
      resolveSlowWatchedText(
        'Date,Name,Year,Letterboxd URI\n2021-03-04,Heat,1995,https://boxd.it/abc\n2021-03-05,Thief,1981,https://boxd.it/def\n'
      );
    });

    expect(screen.queryByText(/Letterboxd \(watched\)/i)).not.toBeInTheDocument();
    expect(startButton).toHaveTextContent('Start Import (1 Films)');

    fireEvent.click(startButton);
    const confirmButton = await screen.findByRole('button', { name: /Confirm Import/i });
    fireEvent.click(confirmButton);

    const recalibrateButton = await screen.findByRole('button', {
      name: /Done — Recalibrate AI Recommendations/i,
    });
    fireEvent.click(recalibrateButton);

    expect(generateRankingsSpy).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves no stuck spinner when picking a new file while an import is processing', async () => {
    let resolveSlowSearch!: (val: any) => void;
    vi.mocked(tmdbService.searchMovies).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSlowSearch = resolve;
        })
    );

    const onClose = vi.fn();
    renderModal(onClose);

    const file1Csv = 'Title,Rating\nInception,10';
    const file1 = new File([file1Csv], 'first_ratings.csv', { type: 'text/csv' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file1] } });

    const startButton = await screen.findByRole('button', { name: /Start Import \(1 Films\)/i });
    expect(startButton).toBeEnabled();

    // Start resolution for file 1 — this sets isProcessing to true
    fireEvent.click(startButton);

    // Modal is now in resolving phase with a spinner button
    expect(await screen.findByRole('button', { name: /Matching\.\.\./i })).toBeInTheDocument();

    // While file 1 resolution is in-flight, user picks a new file (file 2)
    const file2Csv = 'Title,Rating\nInterstellar,9';
    const file2 = new File([file2Csv], 'second_ratings.csv', { type: 'text/csv' });

    await act(async () => {
      fireEvent.change(input, { target: { files: [file2] } });
    });

    // File 2 is now loaded: isProcessing must be false and no stuck spinner
    expect(screen.queryByRole('button', { name: /Matching\.\.\./i })).not.toBeInTheDocument();
    const newStartButton = await screen.findByRole('button', { name: /Start Import \(1 Films\)/i });
    expect(newStartButton).toBeEnabled();
    expect(newStartButton).not.toHaveTextContent(/Resolving/i);

    // Resolve the hung search from file 1 to ensure stale completion does not resurrect isProcessing
    await act(async () => {
      resolveSlowSearch({
        movies: [
          {
            id: 27205,
            title: 'Inception',
            release_date: '2010-07-16',
            vote_average: 8.8,
            vote_count: 25000,
            poster_path: null,
            genres: [],
          },
        ],
        totalPages: 1,
      });
    });

    // Spinner is still not stuck, button remains enabled for file 2
    expect(screen.queryByRole('button', { name: /Matching\.\.\./i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Import \(1 Films\)/i })).toBeEnabled();

    // Verify that the new file can now proceed to resolve and import cleanly
    vi.mocked(tmdbService.searchMovies).mockResolvedValueOnce({
      movies: [
        {
          id: 157336,
          title: 'Interstellar',
          overview: '',
          release_date: '2014-11-05',
          vote_average: 8.6,
          vote_count: 30000,
          poster_path: null,
          backdrop_path: null,
          genres: [],
        },
      ],
      totalPages: 1,
    });
    fireEvent.click(newStartButton);
    expect(await screen.findByRole('button', { name: /Confirm Import/i })).toBeInTheDocument();
  });

  it('resets isProcessing when picking a new file while an import is in-flight even if the new read is slow', async () => {
    let resolveSlowSearch!: (val: any) => void;
    vi.mocked(tmdbService.searchMovies).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSlowSearch = resolve;
        })
    );

    renderModal();

    const file1Csv = 'Title,Rating\nInception,10';
    const file1 = new File([file1Csv], 'first.csv', { type: 'text/csv' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [file1] } });
    const startButton = await screen.findByRole('button', { name: /Start Import/i });
    fireEvent.click(startButton);

    expect(await screen.findByRole('button', { name: /Matching\.\.\./i })).toBeInTheDocument();

    // Start a slow second read
    let resolveSlowText!: (text: string) => void;
    const slowFile = new File(['placeholder'], 'slow.csv', { type: 'text/csv' });
    vi.spyOn(slowFile, 'text').mockImplementationOnce(
      () =>
        new Promise<string>((res) => {
          resolveSlowText = res;
        })
    );

    fireEvent.change(input, { target: { files: [slowFile] } });

    // The resolving spinner from import 1 must immediately disappear
    expect(screen.queryByRole('button', { name: /Matching\.\.\./i })).not.toBeInTheDocument();

    // Finish reading the second file
    await act(async () => {
      resolveSlowText('Title,Rating\nArrival,10');
    });

    const readyButton = await screen.findByRole('button', { name: /Start Import \(1 Films\)/i });
    expect(readyButton).toBeEnabled();
  });

  it('leaves no stuck spinner when picking a new file while a watched import is processing', async () => {
    let resolveSlowSearch!: (val: any) => void;
    vi.mocked(tmdbService.searchMovies).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSlowSearch = resolve;
        })
    );

    const onClose = vi.fn();
    renderModal(onClose);

    const watchedCsv = 'Date,Name,Year,Letterboxd URI\n2021-03-04,Heat,1995,https://boxd.it/abc\n';
    const watchedFile = new File([watchedCsv], 'watched.csv', { type: 'text/csv' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [watchedFile] } });

    const startButton = await screen.findByRole('button', { name: /Start Import \(1 Films\)/i });
    expect(startButton).toBeEnabled();

    // Start watched resolution — sets isProcessing to true
    fireEvent.click(startButton);

    // Modal is in resolving phase with a spinner button
    expect(await screen.findByRole('button', { name: /Matching\.\.\./i })).toBeInTheDocument();

    // While watched resolution is in-flight, pick a new ratings file
    const ratingsCsv = 'Title,Rating\nInterstellar,9';
    const ratingsFile = new File([ratingsCsv], 'ratings.csv', { type: 'text/csv' });

    await act(async () => {
      fireEvent.change(input, { target: { files: [ratingsFile] } });
    });

    // Spinner must not be stuck; new file is ready to import
    expect(screen.queryByRole('button', { name: /Matching\.\.\./i })).not.toBeInTheDocument();
    const newStartButton = await screen.findByRole('button', { name: /Start Import \(1 Films\)/i });
    expect(newStartButton).toBeEnabled();
    expect(newStartButton).not.toHaveTextContent(/Resolving/i);

    // Resolve the hung search from the cancelled watched import
    await act(async () => {
      resolveSlowSearch({
        movies: [
          {
            id: 200,
            title: 'Heat',
            overview: '',
            release_date: '1995-12-15',
            vote_average: 8.2,
            vote_count: 5000,
            poster_path: null,
            genres: [],
          },
        ],
        totalPages: 1,
      });
    });

    // Stale watched resolution must not have written to hidden films or stuck the spinner
    expect(safeGetItem(STORAGE_KEYS.HIDDEN_FILMS)).toBeNull();
    expect(screen.queryByRole('button', { name: /Matching\.\.\./i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Import \(1 Films\)/i })).toBeEnabled();
  });
});
