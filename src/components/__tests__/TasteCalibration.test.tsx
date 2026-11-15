import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/mocks/server';
import { TasteCalibration } from '../TasteCalibration';
import { MovieStoreProvider, useMovieStore } from '../../store/useMovieStore';
import { credentialStore } from '../../services/credentialStore';
import { STORAGE_KEYS, clearInMemoryStoreForTesting } from '../../services/storage';

describe('TasteCalibration hidden films exclusion (CIN-45)', () => {
  beforeEach(() => {
    localStorage.clear();
    clearInMemoryStoreForTesting();
    credentialStore.setTmdbCredential('read_access_token', 'mock-token');
  });

  it('excludes not_for_me films from the calibration grid while keeping seen films present', async () => {
    // Mock the TMDB discover fetch the way the existing calibration tests do
    server.use(
      http.get('https://api.themoviedb.org/3/discover/movie', () => {
        return HttpResponse.json({
          page: 1,
          results: [
            {
              id: 101,
              title: 'Not For Me Test Movie',
              overview: 'Overview for not_for_me film',
              poster_path: null,
              backdrop_path: null,
              release_date: '2023-01-01',
              vote_average: 8.0,
              vote_count: 5000,
              genre_ids: [18],
            },
            {
              id: 102,
              title: 'Seen Test Movie',
              overview: 'Overview for seen film',
              poster_path: null,
              backdrop_path: null,
              release_date: '2023-02-01',
              vote_average: 8.5,
              vote_count: 6000,
              genre_ids: [28],
            },
            {
              id: 103,
              title: 'Normal Unhidden Movie',
              overview: 'Overview for normal unhidden film',
              poster_path: null,
              backdrop_path: null,
              release_date: '2023-03-01',
              vote_average: 7.8,
              vote_count: 4000,
              genre_ids: [35],
            },
          ],
          total_pages: 1,
          total_results: 3,
        });
      })
    );

    // Seed hidden films: 101 is not_for_me, 102 is seen, 103 is unhidden
    const hiddenFilmsSeed = [
      {
        movieId: 101,
        reason: 'not_for_me',
        hiddenAt: Date.now(),
        title: 'Not For Me Test Movie',
      },
      {
        movieId: 102,
        reason: 'seen',
        hiddenAt: Date.now(),
        title: 'Seen Test Movie',
      },
    ];
    localStorage.setItem(STORAGE_KEYS.HIDDEN_FILMS, JSON.stringify(hiddenFilmsSeed));

    render(
      <MovieStoreProvider>
        <TasteCalibration />
      </MovieStoreProvider>
    );

    // The 'seen' film and unhidden film must be present in the calibration grid
    await waitFor(() => {
      expect(screen.getByText('Seen Test Movie')).toBeInTheDocument();
      expect(screen.getByText('Normal Unhidden Movie')).toBeInTheDocument();
    });

    // The 'not_for_me' film must be absent from the calibration grid
    expect(screen.queryByText('Not For Me Test Movie')).not.toBeInTheDocument();
  });

  it('keeps not_for_me excluded and seen present when toggling Hide Rated', async () => {
    server.use(
      http.get('https://api.themoviedb.org/3/discover/movie', () => {
        return HttpResponse.json({
          page: 1,
          results: [
            {
              id: 201,
              title: 'Not For Me Movie 2',
              overview: '',
              poster_path: null,
              backdrop_path: null,
              release_date: '2023-01-01',
              vote_average: 8.0,
              vote_count: 5000,
              genre_ids: [18],
            },
            {
              id: 202,
              title: 'Seen Movie 2',
              overview: '',
              poster_path: null,
              backdrop_path: null,
              release_date: '2023-02-01',
              vote_average: 8.5,
              vote_count: 6000,
              genre_ids: [28],
            },
          ],
          total_pages: 1,
          total_results: 2,
        });
      })
    );

    localStorage.setItem(
      STORAGE_KEYS.HIDDEN_FILMS,
      JSON.stringify([
        { movieId: 201, reason: 'not_for_me', hiddenAt: Date.now(), title: 'Not For Me Movie 2' },
        { movieId: 202, reason: 'seen', hiddenAt: Date.now(), title: 'Seen Movie 2' },
      ])
    );

    render(
      <MovieStoreProvider>
        <TasteCalibration />
      </MovieStoreProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Seen Movie 2')).toBeInTheDocument();
    });
    expect(screen.queryByText('Not For Me Movie 2')).not.toBeInTheDocument();

    // Toggle Hide Rated off -> Show Rated
    const toggleButton = screen.getByTitle('Click to show already rated movies');
    toggleButton.click();

    await waitFor(() => {
      expect(screen.getByText('Seen Movie 2')).toBeInTheDocument();
    });
    expect(screen.queryByText('Not For Me Movie 2')).not.toBeInTheDocument();
  });

});
