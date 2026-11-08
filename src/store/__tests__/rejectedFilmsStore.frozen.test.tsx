import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MovieStoreProvider, useMovieStore } from '../useMovieStore';
import { aiManager } from '../../services/ai/aiManager';
import { credentialStore } from '../../services/credentialStore';
import { getCandidateRecommendationPool } from '../../services/recommendation/candidateSources';
import {
  STORAGE_KEYS,
  safeGetItem,
  validateHiddenFilms,
  clearInMemoryStoreForTesting,
} from '../../services/storage';
import type { HiddenFilm, Movie, UserRating } from '../../types';

vi.mock('../../services/recommendation/candidateSources', async () => {
  const actual = await vi.importActual<typeof import('../../services/recommendation/candidateSources')>(
    '../../services/recommendation/candidateSources'
  );
  return { ...actual, getCandidateRecommendationPool: vi.fn() };
});

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MovieStoreProvider>{children}</MovieStoreProvider>
);

const candidate: Movie = {
  id: 500,
  title: 'Candidate',
  overview: 'A film.',
  release_date: '1994-05-01',
  vote_average: 7,
  vote_count: 1000,
  poster_path: null,
  backdrop_path: null,
  genres: [
    { id: 1, name: 'Drama' },
    { id: 2, name: 'Thriller' },
  ],
} as Movie;

const rated = (movieId: number): UserRating =>
  ({
    movieId,
    title: `Rated ${movieId}`,
    rating: 9,
    posterPath: null,
    genres: ['Drama'],
    ratedAt: movieId,
  }) as UserRating;

const hiddenEntry = (over: Partial<HiddenFilm> & { movieId: number }): HiddenFilm => ({
  reason: 'not_for_me',
  hiddenAt: over.movieId,
  title: `Hidden ${over.movieId}`,
  ...over,
});

describe('Rejected films through the store (frozen)', () => {
  const generateSpy = () =>
    vi.spyOn(aiManager, 'generateRecommendations').mockResolvedValue({
      recommendations: [
        {
          movie: candidate,
          score: 90,
          rank: 1,
          reason: 'Because',
          serendipityType: 'safe_bet',
          highlightTags: [],
        },
      ],
      usedProvider: 'Mocked',
    });

  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    credentialStore.forgetAll();
    credentialStore.setTmdbCredential('api_key', 'tmdb-test-key');
    vi.mocked(getCandidateRecommendationPool).mockResolvedValue([candidate]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(getCandidateRecommendationPool).mockReset();
  });

  it('passes recent "not for me" films to the provider, and not "seen" films', async () => {
    const spy = generateSpy();
    const { result } = renderHook(() => useMovieStore(), { wrapper });

    act(() => {
      result.current.importRatingsList([rated(1)]);
      result.current.hideFilms([
        hiddenEntry({ movieId: 20, year: '1994', genres: ['Drama', 'Thriller'] }),
        hiddenEntry({ movieId: 21, reason: 'seen' }),
      ]);
    });
    await act(async () => {
      await result.current.generateRankings();
    });

    const request = spy.mock.lastCall![1];
    expect(request.rejectedFilms).toEqual([
      { title: 'Hidden 20', year: '1994', genres: ['Drama', 'Thriller'] },
    ]);
  });

  it('never seeds candidates from a hidden film, for either reason', async () => {
    generateSpy();
    const { result } = renderHook(() => useMovieStore(), { wrapper });

    act(() => {
      result.current.importRatingsList([rated(1), rated(2), rated(3)]);
      result.current.hideFilms([
        hiddenEntry({ movieId: 2 }),
        hiddenEntry({ movieId: 3, reason: 'seen' }),
      ]);
    });
    await act(async () => {
      await result.current.generateRankings();
    });

    const options = vi.mocked(getCandidateRecommendationPool).mock.lastCall![0];
    expect(options.seedMovieIds).toEqual([1]);
    expect((options.userRatings as UserRating[]).map((r) => r.movieId)).toEqual([1]);
  });

  it('keeps hidden films that were rated in the taste profile sent to the provider', async () => {
    const spy = generateSpy();
    const { result } = renderHook(() => useMovieStore(), { wrapper });

    act(() => {
      result.current.importRatingsList([rated(1), rated(2)]);
      result.current.hideFilms([hiddenEntry({ movieId: 2, reason: 'seen' })]);
    });
    await act(async () => {
      await result.current.generateRankings();
    });

    expect(spy.mock.lastCall![1].userRatings.map((r: UserRating) => r.movieId).sort()).toEqual([1, 2]);
  });

  it('records year and genres when a recommended film is hidden, and they survive storage', async () => {
    generateSpy();
    const { result } = renderHook(() => useMovieStore(), { wrapper });

    act(() => {
      result.current.importRatingsList([rated(1)]);
    });
    await act(async () => {
      await result.current.generateRankings();
    });
    act(() => {
      result.current.hideFilm(500, 'not_for_me', 'Candidate');
    });

    const saved = validateHiddenFilms(JSON.parse(safeGetItem(STORAGE_KEYS.HIDDEN_FILMS)!));
    expect(saved).toEqual([
      expect.objectContaining({
        movieId: 500,
        reason: 'not_for_me',
        title: 'Candidate',
        year: '1994',
        genres: ['Drama', 'Thriller'],
      }),
    ]);
  });

  it('still hides a film that is not in the current recommendations', () => {
    const { result } = renderHook(() => useMovieStore(), { wrapper });

    act(() => {
      result.current.hideFilm(777, 'not_for_me', 'Elsewhere');
    });

    expect(result.current.hiddenFilms).toEqual([
      expect.objectContaining({ movieId: 777, reason: 'not_for_me', title: 'Elsewhere' }),
    ]);
  });
});

describe('validateHiddenFilms with the new fields (frozen)', () => {
  it('reads old entries unchanged', () => {
    const old = { movieId: 1, reason: 'seen', hiddenAt: 5, title: 'Old' };

    expect(validateHiddenFilms([old])).toEqual([old]);
  });

  it('drops malformed year and genres but keeps the entry', () => {
    const [entry] = validateHiddenFilms([
      { movieId: 1, reason: 'not_for_me', hiddenAt: 5, title: 'T', year: 1994, genres: 'Drama' },
    ]);

    expect(entry).toEqual({ movieId: 1, reason: 'not_for_me', hiddenAt: 5, title: 'T' });
  });

  it('keeps only string genres', () => {
    const [entry] = validateHiddenFilms([
      { movieId: 1, reason: 'not_for_me', hiddenAt: 5, year: '1994', genres: ['Drama', 7, null] },
    ]);

    expect(entry.year).toBe('1994');
    expect(entry.genres).toEqual(['Drama']);
  });
});
