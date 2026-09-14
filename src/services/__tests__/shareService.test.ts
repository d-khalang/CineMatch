import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getShareUrl, shareMovie } from '../shareService';
import { Movie } from '../../types';

describe('shareService URL resolution and sharing', () => {
  const baseMovie: Movie = {
    id: 550,
    title: 'Fight Club',
    overview: 'An insomniac office worker...',
    release_date: '1999-10-15',
    vote_average: 8.4,
    vote_count: 26000,
    poster_path: '/poster.jpg',
    backdrop_path: '/backdrop.jpg',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('generates IMDb URL when movie has a valid imdb_id', () => {
    const movieWithImdb: Movie = {
      ...baseMovie,
      id: 991,
      imdb_id: 'tt0137523',
    };

    const url = getShareUrl(movieWithImdb);
    expect(url).toBe('https://www.imdb.com/title/tt0137523/');
  });

  it('falls back to TMDB movie URL when imdb_id is missing or malformed', () => {
    const url = getShareUrl(baseMovie);
    expect(url).toBe('https://www.themoviedb.org/movie/550');

    const movieWithInvalidImdb: Movie = {
      ...baseMovie,
      id: 551,
      imdb_id: 'invalid-id-1234',
    };
    expect(getShareUrl(movieWithInvalidImdb)).toBe('https://www.themoviedb.org/movie/551');
  });

  it('copies to clipboard when Web Share is unavailable', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      share: undefined,
      clipboard: { writeText: writeTextMock },
    });

    const result = await shareMovie(baseMovie);
    expect(result.success).toBe(true);
    expect(result.type).toBe('copied');
    expect(writeTextMock).toHaveBeenCalledWith('https://www.themoviedb.org/movie/550');
  });

  it('uses navigator.share when available', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      share: shareMock,
    });

    const result = await shareMovie(baseMovie);
    expect(result.success).toBe(true);
    expect(result.type).toBe('shared');
    expect(shareMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Fight Club (1999)',
        url: 'https://www.themoviedb.org/movie/550',
      })
    );
  });
});
