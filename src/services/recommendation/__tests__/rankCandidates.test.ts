import { describe, it, expect, vi } from 'vitest';
import { rankCandidates } from '../rankCandidates';
import { mixForSerendipityLevel } from '../scoring';
import { annotateCandidateMovies, toCandidates } from '../candidateMovies';
import type { BucketMix, Candidate } from '../types';
import type { Movie, UserRating } from '../../../types';

function makeCandidate(
  id: number,
  overrides: Partial<Movie> = {},
  sources: Candidate['sources'] = ['seed_graph'],
  seedNeighbour = true
): Candidate {
  return {
    movie: {
      id,
      title: `Film_${id}`,
      overview: `Overview ${id}`,
      poster_path: `/p${id}.jpg`,
      backdrop_path: null,
      release_date: '2015-06-01',
      vote_average: 7.8,
      vote_count: 2000,
      genres: [{ id: 18, name: 'Drama' }],
      director: 'Jane Director',
      ...overrides,
    },
    sources,
    seedNeighbour,
  };
}

describe('rankCandidates (unit)', () => {
  const ratings: UserRating[] = [
    {
      movieId: 1001,
      title: 'Loved Drama',
      rating: 10,
      posterPath: null,
      year: '2014',
      genres: ['Drama', 'Crime'],
      director: 'Jane Director',
      ratedAt: 1000,
    },
    {
      movieId: 1002,
      title: 'Liked Crime',
      rating: 9,
      posterPath: null,
      year: '2016',
      genres: ['Crime'],
      director: 'Jane Director',
      ratedAt: 2000,
    },
  ];

  it('populates highlightTags from matched genres sorted by user affinity', () => {
    const pool = [
      makeCandidate(1, {
        genres: [
          { id: 35, name: 'Comedy' },
          { id: 80, name: 'Crime' },
          { id: 18, name: 'Drama' },
        ],
      }),
    ];

    const [rec] = rankCandidates(pool, ratings, { serendipityLevel: 20 });
    expect(rec.highlightTags).toEqual(['Crime', 'Drama']);
  });

  it('maps below_floor to thematic_gem when all candidates fall below relevance floor', () => {
    const allNegativeRatings: UserRating[] = [
      {
        movieId: 2001,
        title: 'Hated 1',
        rating: 1,
        posterPath: null,
        genres: ['Horror'],
        ratedAt: 1000,
      },
      {
        movieId: 2002,
        title: 'Hated 2',
        rating: 1,
        posterPath: null,
        genres: ['Horror'],
        ratedAt: 2000,
      },
    ];

    const pool = [makeCandidate(10, { genres: [{ id: 27, name: 'Horror' }] }, ['hidden_gem'], false)];
    const [rec] = rankCandidates(pool, allNegativeRatings, { serendipityLevel: 50 });

    expect(rec.bucket).toBe('below_floor');
    expect(rec.serendipityType).toBe('thematic_gem');
    expect(rec.reason.toLowerCase()).toContain('long-shot');
  });

  it('names liked genre or director for safe_bet and explains what is new and why worth the risk for stretch/wildcard', () => {
    const pool: Candidate[] = [
      makeCandidate(
        1,
        {
          genres: [{ id: 18, name: 'Drama' }, { id: 80, name: 'Crime' }],
          director: 'Jane Director',
          vote_count: 30000,
          release_date: '2015-01-01',
        },
        ['seed_graph'],
        true
      ),
      makeCandidate(
        2,
        {
          genres: [{ id: 18, name: 'Drama' }],
          director: 'Other Director',
          vote_count: 15000,
          release_date: '2016-01-01',
        },
        ['seed_graph'],
        true
      ),
      makeCandidate(
        3,
        {
          genres: [{ id: 18, name: 'Drama' }, { id: 878, name: 'Science Fiction' }],
          director: 'New Director',
          vote_count: 400,
          vote_average: 8.1,
          release_date: '1985-01-01',
        },
        ['creator_graph'],
        false
      ),
      makeCandidate(
        4,
        {
          genres: [{ id: 37, name: 'Western' }],
          director: 'Wild Director',
          vote_count: 120,
          vote_average: 8.0,
          release_date: '1968-01-01',
        },
        ['hidden_gem'],
        false
      ),
    ];

    const recs = rankCandidates(pool, ratings, { serendipityLevel: 80 });
    const safeRec = recs.find((r) => r.bucket === 'safe_bet');
    const stretchRec = recs.find((r) => r.bucket === 'stretch');
    const wildcardRec = recs.find((r) => r.bucket === 'wildcard');

    expect(safeRec).toBeDefined();
    expect(safeRec!.reason).toMatch(/Jane Director|Drama|Crime/);

    expect(stretchRec).toBeDefined();
    expect(stretchRec!.movie.id).toBe(3);
    expect(stretchRec!.serendipityType).toBe('director_match');
    expect(stretchRec!.reason.toLowerCase()).toContain('worth the risk');

    expect(wildcardRec).toBeDefined();
    expect(wildcardRec!.serendipityType).toBe('wildcard_discovery');
    expect(wildcardRec!.reason.toLowerCase()).toContain('worth the risk');
  });

  it('maps stretch without creator_graph to thematic_gem', () => {
    const pool: Candidate[] = [
      makeCandidate(
        1,
        {
          genres: [{ id: 18, name: 'Drama' }, { id: 80, name: 'Crime' }],
          director: 'Jane Director',
          vote_count: 30000,
          release_date: '2015-01-01',
        },
        ['seed_graph'],
        true
      ),
      makeCandidate(
        2,
        {
          genres: [{ id: 18, name: 'Drama' }],
          director: 'Other Director',
          vote_count: 15000,
          release_date: '2016-01-01',
        },
        ['seed_graph'],
        true
      ),
      makeCandidate(
        3,
        {
          genres: [{ id: 18, name: 'Drama' }, { id: 878, name: 'Science Fiction' }],
          director: 'New Director',
          vote_count: 400,
          vote_average: 8.1,
          release_date: '1985-01-01',
        },
        ['hidden_gem'],
        false
      ),
      makeCandidate(
        4,
        {
          genres: [{ id: 37, name: 'Western' }],
          director: 'Wild Director',
          vote_count: 120,
          vote_average: 8.0,
          release_date: '1968-01-01',
        },
        ['hidden_gem'],
        false
      ),
    ];

    const recs = rankCandidates(pool, ratings, { serendipityLevel: 80 });
    const stretchRec = recs.find((r) => r.bucket === 'stretch');
    expect(stretchRec).toBeDefined();
    expect(stretchRec!.movie.id).toBe(3);
    expect(stretchRec!.serendipityType).toBe('thematic_gem');
  });

  it('forwards preferredEras and selectedVibes to boost matching candidates', () => {
    const matching = makeCandidate(
      1,
      {
        title: 'Neon Eighties',
        overview: 'A cyberpunk detective story.',
        keywords: ['cyberpunk'],
        release_date: '1984-05-01',
        vote_count: 5000,
        genres: [{ id: 18, name: 'Drama' }],
      },
      ['era', 'vibe'],
      true
    );
    const plain = makeCandidate(
      2,
      {
        title: 'Modern Drama',
        overview: 'A quiet family story.',
        keywords: ['family'],
        release_date: '2015-05-01',
        vote_count: 5000,
        genres: [{ id: 18, name: 'Drama' }],
      },
      ['seed_graph'],
      true
    );

    const recs = rankCandidates([plain, matching], ratings, {
      serendipityLevel: 30,
      preferredEras: ['1980s'],
      selectedVibes: ['cyberpunk'],
    });

    const matchRec = recs.find((r) => r.movie.id === 1)!;
    const plainRec = recs.find((r) => r.movie.id === 2)!;
    expect(matchRec.score).toBeGreaterThan(plainRec.score);
  });

  it('handles single-item pool, invalid sizes, NaN serendipity, and clamping at 0', () => {
    const single = [makeCandidate(1, { genres: [{ id: 18, name: 'Drama' }] })];
    const singleRecs = rankCandidates(single, ratings, { serendipityLevel: Number.NaN });
    expect(singleRecs).toHaveLength(1);
    expect(singleRecs[0].rank).toBe(1);
    expect(singleRecs[0].bucket).toBeDefined();

    expect(rankCandidates(single, ratings, { serendipityLevel: 30, size: 0 })).toEqual([]);
    expect(rankCandidates(single, ratings, { serendipityLevel: 30, size: -5 })).toEqual([]);
    expect(rankCandidates(single, ratings, { serendipityLevel: 30, size: Number.NaN })).toHaveLength(1);

    // Low relevance below_floor candidate with heavy rejectionPenalty clamps cleanly at >= 0
    const hatedRatings: UserRating[] = [
      { movieId: 91, title: 'Bad 1', rating: 1, posterPath: null, genres: ['Horror', 'Thriller'], ratedAt: 1 },
      { movieId: 92, title: 'Bad 2', rating: 1, posterPath: null, genres: ['Horror', 'Thriller'], ratedAt: 2 },
    ];
    const weakPool = [
      makeCandidate(
        77,
        {
          genres: [{ id: 27, name: 'Horror' }, { id: 53, name: 'Thriller' }],
          release_date: '1994-01-01',
          vote_average: 3.0,
        },
        ['acclaimed_baseline'],
        false
      ),
    ];
    const clampedRecs = rankCandidates(weakPool, hatedRatings, {
      serendipityLevel: 30,
      rejectedFilms: [
        { title: 'R1', year: '1995', genres: ['Horror', 'Thriller'] },
        { title: 'R2', year: '1996', genres: ['Horror', 'Thriller'] },
      ],
    });
    expect(clampedRecs).toHaveLength(1);
    expect(clampedRecs[0].score).toBeGreaterThanOrEqual(0);
    expect(clampedRecs[0].score).toBeLessThanOrEqual(100);
  });

  it('annotateCandidateMovies and toCandidates handle empty lists and missing metadata', () => {
    expect(annotateCandidateMovies([])).toEqual([]);
    expect(toCandidates([])).toEqual([]);
    const [reconstructed] = toCandidates([
      {
        id: 5,
        title: 'Plain Film',
        overview: '',
        poster_path: null,
        backdrop_path: null,
        release_date: '2020-01-01',
        vote_average: 7.0,
        vote_count: 100,
      },
    ]);
    expect(reconstructed.sources).toEqual([]);
    expect(reconstructed.seedNeighbour).toBe(false);
  });

  it('supports optional adaptMix: increases wildcard count when mix shifts upward and leaves output identical without it', () => {
    const pool: Candidate[] = Array.from({ length: 30 }, (_, idx) => {
      const id = idx + 1;
      const isExplorer = idx >= 20;
      return makeCandidate(
        id,
        {
          genres: isExplorer
            ? [{ id: 18, name: 'Drama' }, { id: 37, name: 'Western' }]
            : [{ id: 18, name: 'Drama' }, { id: 80, name: 'Crime' }],
          director: isExplorer ? `Explorer Director ${id}` : 'Jane Director',
          release_date: isExplorer ? '1970-01-01' : '2015-06-01',
          vote_average: 8.2,
          vote_count: isExplorer ? 200 + idx : 20000 - idx * 100,
        },
        isExplorer ? ['hidden_gem'] : ['seed_graph'],
        !isExplorer
      );
    });

    const baseline = rankCandidates(pool, ratings, { serendipityLevel: 30, size: 20 });
    const explicitUndefined = rankCandidates(pool, ratings, {
      serendipityLevel: 30,
      size: 20,
      adaptMix: undefined,
    });
    expect(explicitUndefined).toEqual(baseline);

    const adaptSpy = vi.fn((base: BucketMix): BucketMix => ({
      safe_bet: base.safe_bet - 0.1,
      stretch: base.stretch,
      wildcard: base.wildcard + 0.1,
    }));

    const adapted = rankCandidates(pool, ratings, {
      serendipityLevel: 30,
      size: 20,
      adaptMix: adaptSpy,
    });

    expect(adaptSpy).toHaveBeenCalledTimes(1);
    expect(adaptSpy).toHaveBeenCalledWith(mixForSerendipityLevel(30));

    const baselineWildcards = baseline.filter((r) => r.bucket === 'wildcard').length;
    const adaptedWildcards = adapted.filter((r) => r.bucket === 'wildcard').length;
    expect(adaptedWildcards).toBeGreaterThanOrEqual(baselineWildcards);
    expect(adaptedWildcards).toBeGreaterThan(baselineWildcards);
  });
});
