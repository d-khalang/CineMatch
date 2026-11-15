import { describe, it, expect } from 'vitest';
import { famePenalty, FAME_PENALTY_MAX } from '../fame';
import { LocalProvider } from '../../ai/localProvider';
import type { Movie, UserRating } from '../../../types';

// Frozen spec for CIN-48 ("Off the beaten path"). Do not edit.

const candidate = (id: number, voteCount: number): Movie =>
  ({
    id,
    title: `Candidate ${id}`,
    overview: 'A film.',
    release_date: '1995-01-01',
    vote_average: 7,
    vote_count: voteCount,
    poster_path: null,
    backdrop_path: null,
    genres: [{ id: 37, name: 'Western' }],
  }) as Movie;

const ratings = (n: number): UserRating[] =>
  Array.from({ length: n }, (_, i) =>
    ({
      movieId: 100000 + i,
      title: `Rated ${i}`,
      rating: 8,
      posterPath: null,
      genres: ['Drama'],
      ratedAt: i,
    }) as UserRating,
  );

describe('famePenalty', () => {
  it('is zero for films with 1,000 votes or fewer', () => {
    expect(famePenalty(800, 85, 600)).toBe(0);
    expect(famePenalty(1000, 100, 1000)).toBe(0);
  });

  it('is zero for missing or invalid vote counts', () => {
    expect(famePenalty(undefined, 85, 600)).toBe(0);
    expect(famePenalty(Number.NaN, 85, 600)).toBe(0);
    expect(famePenalty(-5, 85, 600)).toBe(0);
  });

  it('is zero for new users and at low serendipity', () => {
    expect(famePenalty(30000, 85, 49)).toBe(0);
    expect(famePenalty(30000, 30, 600)).toBe(0);
    expect(famePenalty(30000, 0, 600)).toBe(0);
  });

  it('is a soft demotion capped at FAME_PENALTY_MAX', () => {
    expect(FAME_PENALTY_MAX).toBe(12);
    expect(famePenalty(5_000_000, 100, 5000)).toBeLessThanOrEqual(FAME_PENALTY_MAX);
    expect(famePenalty(5_000_000, 100, 5000)).toBeGreaterThan(0);
  });

  it('grows with vote count, serendipity and rating count', () => {
    expect(famePenalty(30000, 85, 600)).toBeGreaterThan(famePenalty(5000, 85, 600));
    expect(famePenalty(30000, 85, 600)).toBeGreaterThan(famePenalty(30000, 50, 600));
    expect(famePenalty(30000, 85, 600)).toBeGreaterThan(famePenalty(30000, 85, 100));
  });

  it('demotes a 30k-vote film by at least 6 points at serendipity 85 and 600 ratings', () => {
    expect(famePenalty(30000, 85, 600)).toBeGreaterThanOrEqual(6);
  });
});

describe('LocalProvider with fame penalty', () => {
  it('ranks an equally scored 800-vote film above a 30k-vote film at serendipity 85 and 600 ratings', async () => {
    const result = await new LocalProvider().generateRecommendations({
      userRatings: ratings(600),
      candidatePool: [candidate(1, 30000), candidate(2, 800)],
      serendipityLevel: 85,
    });
    const ids = result.recommendations.map((r) => r.movie.id);
    expect(ids).toEqual([2, 1]);
    expect(result.recommendations[0].score).toBeGreaterThan(result.recommendations[1].score);
  });

  it('never excludes a famous film', async () => {
    const result = await new LocalProvider().generateRecommendations({
      userRatings: ratings(600),
      candidatePool: [candidate(1, 2_000_000)],
      serendipityLevel: 100,
    });
    expect(result.recommendations.map((r) => r.movie.id)).toEqual([1]);
  });

  it('leaves scores unchanged at low serendipity', async () => {
    const result = await new LocalProvider().generateRecommendations({
      userRatings: ratings(600),
      candidatePool: [candidate(1, 30000), candidate(2, 800)],
      serendipityLevel: 20,
    });
    expect(result.recommendations[0].score).toBe(result.recommendations[1].score);
  });
});
