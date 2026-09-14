import { describe, it, expect } from 'vitest';
import { LocalProvider } from '../localProvider';
import { Movie, UserRating } from '../../../types';

describe('LocalProvider Heuristic Engine', () => {
  const provider = new LocalProvider();

  const mockCandidatePool: Movie[] = [
    {
      id: 1,
      title: 'Inception',
      overview: 'A mind-bending heist in dreams with high tension.',
      release_date: '2010-07-16',
      vote_average: 8.4,
      vote_count: 35000,
      poster_path: null,
      backdrop_path: null,
      director: 'Christopher Nolan',
      genres: [{ id: 878, name: 'Sci-Fi' }, { id: 28, name: 'Action' }],
    },
    {
      id: 2,
      title: 'Interstellar',
      overview: 'Mankind exploration into black holes and wormholes.',
      release_date: '2014-11-07',
      vote_average: 8.6,
      vote_count: 32000,
      poster_path: null,
      backdrop_path: null,
      director: 'Christopher Nolan',
      genres: [{ id: 878, name: 'Sci-Fi' }, { id: 18, name: 'Drama' }],
    },
    {
      id: 3,
      title: 'The Room',
      overview: 'An infamous melodrama.',
      release_date: '2003-06-27',
      vote_average: 3.5,
      vote_count: 1500,
      poster_path: null,
      backdrop_path: null,
      director: 'Tommy Wiseau',
      genres: [{ id: 18, name: 'Drama' }],
    },
  ];

  it('provides baseline starter recommendations when user has no ratings', async () => {
    const result = await provider.generateRecommendations({
      userRatings: [],
      candidatePool: mockCandidatePool,
      serendipityLevel: 30,
    });

    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations[0].rank).toBe(1);
    expect(result.recommendations[0].serendipityType).toBe('safe_bet');
  });

  it('boosts films matching user high-rated genres and directors', async () => {
    const userRatings: UserRating[] = [
      {
        movieId: 99,
        title: 'Oppenheimer',
        rating: 10,
        posterPath: null,
        director: 'Christopher Nolan',
        genres: ['Drama', 'History'],
        ratedAt: Date.now(),
      },
      {
        movieId: 98,
        title: 'Tenet',
        rating: 9,
        posterPath: null,
        director: 'Christopher Nolan',
        genres: ['Sci-Fi', 'Action'],
        ratedAt: Date.now(),
      },
    ];

    const result = await provider.generateRecommendations({
      userRatings,
      candidatePool: mockCandidatePool,
      serendipityLevel: 20,
    });

    // Inception and Interstellar should rank at the top with high scores due to Christopher Nolan + Sci-Fi
    expect(result.recommendations[0].movie.director).toBe('Christopher Nolan');
    expect(result.recommendations[0].score).toBeGreaterThanOrEqual(80);
    expect(result.recommendations[0].score).toBeLessThanOrEqual(99);
  });

  it('penalizes low-rated genres', async () => {
    const userRatings: UserRating[] = [
      {
        movieId: 50,
        title: 'Bad Action Film',
        rating: 1, // Heavy negative penalty for Action
        posterPath: null,
        genres: ['Action'],
        ratedAt: Date.now(),
      },
      {
        movieId: 51,
        title: 'Beloved Drama',
        rating: 10, // Positive affinity for Drama
        posterPath: null,
        genres: ['Drama'],
        ratedAt: Date.now(),
      },
    ];

    const result = await provider.generateRecommendations({
      userRatings,
      candidatePool: mockCandidatePool,
      serendipityLevel: 10,
    });

    // Interstellar (Sci-Fi, Drama) should rank higher than Inception (Sci-Fi, Action)
    const interstellarIndex = result.recommendations.findIndex((r) => r.movie.id === 2);
    const inceptionIndex = result.recommendations.findIndex((r) => r.movie.id === 1);
    expect(interstellarIndex).toBeLessThan(inceptionIndex);
  });

  it('clamps all output scores strictly between 45 and 99', async () => {
    const userRatings: UserRating[] = [
      {
        movieId: 10,
        title: 'Masterpiece',
        rating: 10,
        posterPath: null,
        director: 'Christopher Nolan',
        genres: ['Sci-Fi'],
        ratedAt: Date.now(),
      },
    ];

    const result = await provider.generateRecommendations({
      userRatings,
      candidatePool: mockCandidatePool,
      serendipityLevel: 100, // max serendipity
    });

    result.recommendations.forEach((rec) => {
      expect(rec.score).toBeGreaterThanOrEqual(45);
      expect(rec.score).toBeLessThanOrEqual(99);
      expect(rec.rank).toBeGreaterThan(0);
    });
  });

  it('respects AbortSignal cancellation', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.generateRecommendations(
        {
          userRatings: [],
          candidatePool: mockCandidatePool,
          serendipityLevel: 30,
        },
        controller.signal
      )
    ).rejects.toThrow();
  });
});
