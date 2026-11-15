import { describe, it, expect } from 'vitest';
import { famePenalty, FAME_PENALTY_MAX } from '../fame';
import { LocalProvider } from '../../ai/localProvider';
import type { Movie, UserRating } from '../../../types';

const makeCandidate = (id: number, voteCount?: number): Movie =>
  ({
    id,
    title: `Candidate ${id}`,
    overview: 'A film.',
    release_date: '1995-01-01',
    vote_average: 7.4,
    vote_count: voteCount as number,
    poster_path: null,
    backdrop_path: null,
    genres: [{ id: 37, name: 'Western' }],
  }) as Movie;

const makeRatings = (n: number): UserRating[] =>
  Array.from({ length: n }, (_, i) =>
    ({
      movieId: 200000 + i,
      title: `Rated ${i}`,
      rating: 8,
      posterPath: null,
      genres: ['Drama'],
      ratedAt: i,
    }) as UserRating,
  );

describe('famePenalty edge cases', () => {
  it('returns 0 at exact lower thresholds and becomes positive immediately above them', () => {
    expect(famePenalty(1000, 100, 400)).toBe(0);
    expect(famePenalty(1001, 100, 400)).toBeGreaterThan(0);

    expect(famePenalty(30000, 30, 400)).toBe(0);
    expect(famePenalty(30000, 31, 400)).toBeGreaterThan(0);

    expect(famePenalty(30000, 100, 50)).toBe(0);
    expect(famePenalty(30000, 100, 51)).toBeGreaterThan(0);
  });

  it('reaches FAME_PENALTY_MAX at 30k votes, serendipity 100, and 400+ ratings', () => {
    expect(famePenalty(30000, 100, 400)).toBe(FAME_PENALTY_MAX);
    expect(famePenalty(150000, 100, 400)).toBe(FAME_PENALTY_MAX);
    expect(famePenalty(30000, 120, 1000)).toBe(FAME_PENALTY_MAX);
  });

  it('handles non-finite inputs safely by returning 0', () => {
    expect(famePenalty(Number.POSITIVE_INFINITY, 85, 600)).toBe(0);
    expect(famePenalty(Number.NEGATIVE_INFINITY, 85, 600)).toBe(0);
    expect(famePenalty(30000, Number.NaN, 600)).toBe(0);
    expect(famePenalty(30000, 85, Number.NaN)).toBe(0);
  });
});

describe('LocalProvider fame penalty boundary behavior', () => {
  it('leaves scores unchanged when user has fewer than 50 ratings even at max serendipity', async () => {
    const result = await new LocalProvider().generateRecommendations({
      userRatings: makeRatings(49),
      candidatePool: [makeCandidate(1, 30000), makeCandidate(2, 800)],
      serendipityLevel: 100,
    });

    expect(result.recommendations).toHaveLength(2);
    expect(result.recommendations[0].score).toBe(result.recommendations[1].score);
  });

  it('leaves scores unchanged at serendipity 30 even with 600 ratings', async () => {
    const result = await new LocalProvider().generateRecommendations({
      userRatings: makeRatings(600),
      candidatePool: [makeCandidate(1, 30000), makeCandidate(2, 800)],
      serendipityLevel: 30,
    });

    expect(result.recommendations).toHaveLength(2);
    expect(result.recommendations[0].score).toBe(result.recommendations[1].score);
  });

  it('handles missing vote_count without NaN scores and keeps candidate in pool', async () => {
    const result = await new LocalProvider().generateRecommendations({
      userRatings: makeRatings(600),
      candidatePool: [makeCandidate(1, undefined), makeCandidate(2, 30000)],
      serendipityLevel: 85,
    });

    expect(result.recommendations.map((r) => r.movie.id)).toEqual([1, 2]);
    for (const rec of result.recommendations) {
      expect(Number.isFinite(rec.score)).toBe(true);
      expect(rec.score).toBeGreaterThanOrEqual(45);
      expect(rec.score).toBeLessThanOrEqual(99);
    }
  });
});
