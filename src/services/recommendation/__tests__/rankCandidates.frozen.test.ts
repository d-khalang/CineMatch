import { describe, it, expect } from 'vitest';
import { rankCandidates } from '../rankCandidates';
import { annotateCandidateMovies, toCandidates } from '../candidateMovies';
import { LocalProvider } from '../../ai/localProvider';
import { getSeriesKey } from '../../../constants/franchises';
import type { Candidate, CandidateSource } from '../types';
import type { Movie, UserRating } from '../../../types';

// Frozen spec for CIN-9 (scoring pipeline in the local engine). Do not edit.

const GENRES = ['Drama', 'Crime', 'Thriller', 'Comedy', 'Science Fiction', 'Horror', 'Romance', 'Animation', 'Western', 'Documentary'];
const DIRECTORS = ['Director A', 'Director B', 'Director C', 'Director D', 'Director E', 'Director F'];
const SOURCES: CandidateSource[] = ['seed_graph', 'creator_graph', 'keyword_affinity', 'hidden_gem', 'bridge', 'acclaimed_baseline'];

// Deterministic pseudo-random numbers so the fixture never changes.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function heavyRatings(n = 200): UserRating[] {
  const r = rng(7);
  return Array.from({ length: n }, (_, i) => {
    // Mostly Drama, Crime and Thriller lovers; other genres rated low.
    const low = i % 5 === 4;
    const main = low ? GENRES[3 + Math.floor(r() * 7)] : GENRES[Math.floor(r() * 3)];
    const second = GENRES[Math.floor(r() * GENRES.length)];
    const rating = low ? 2 + Math.floor(r() * 4) : 7 + Math.floor(r() * 4);
    return {
      movieId: 100000 + i,
      title: `Rated ${i}`,
      rating,
      posterPath: null,
      genres: Array.from(new Set([main, second])),
      director: DIRECTORS[Math.floor(r() * DIRECTORS.length)],
      keywords: [`kw${Math.floor(r() * 20)}`],
      year: String(1960 + Math.floor(r() * 60)),
      ratedAt: i,
    } as UserRating;
  });
}

// Distinct titles that the franchise stemmer keeps apart: no digits, no roman-numeral letters.
const SAFE_LETTERS = 'abefghjknopqrstuwyz';
function uniqueTitle(id: number): string {
  let n = id;
  let word = '';
  do {
    word = SAFE_LETTERS[n % SAFE_LETTERS.length] + word;
    n = Math.floor(n / SAFE_LETTERS.length);
  } while (n > 0);
  return `Film ${word}q`;
}

function candidate(id: number, r: () => number, title = uniqueTitle(id)): Candidate {
  const g1 = GENRES[Math.floor(r() * GENRES.length)];
  const g2 = GENRES[Math.floor(r() * GENRES.length)];
  const source = SOURCES[Math.floor(r() * SOURCES.length)];
  return {
    movie: {
      id,
      title,
      overview: `Overview ${id}`,
      poster_path: null,
      backdrop_path: null,
      release_date: `${1950 + Math.floor(r() * 75)}-06-01`,
      vote_average: 6 + r() * 2.5,
      vote_count: 50 + Math.floor(r() * 40000),
      genres: Array.from(new Set([g1, g2])).map((name, i) => ({ id: i + 1, name })),
      director: DIRECTORS[Math.floor(r() * DIRECTORS.length)],
      keywords: [`kw${Math.floor(r() * 20)}`, `kw${Math.floor(r() * 40)}`],
    } as Movie,
    sources: [source],
    seedNeighbour: source === 'seed_graph',
  };
}

function heavyPool(n = 150): Candidate[] {
  const r = rng(42);
  return Array.from({ length: n }, (_, i) => candidate(1 + i, r));
}

const VALID_BUCKETS = ['safe_bet', 'stretch', 'wildcard', 'below_floor'];

describe('rankCandidates', () => {
  const ratings = heavyRatings();
  const pool = heavyPool();

  it('returns 30 ranked results for a heavy fixture', () => {
    const recs = rankCandidates(pool, ratings, { serendipityLevel: 30 });
    expect(recs).toHaveLength(30);
    expect(recs.map((r) => r.rank)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it('honours a custom size', () => {
    expect(rankCandidates(pool, ratings, { serendipityLevel: 30, size: 12 })).toHaveLength(12);
  });

  it('never returns rated, excluded or duplicate films', () => {
    const ratedFilm = candidate(100003, rng(1)); // 100003 is a rated movieId
    const recs = rankCandidates([ratedFilm, ...pool, ...pool.slice(0, 10)], ratings, {
      serendipityLevel: 50,
      size: 150,
      excludeIds: new Set([1, 2, 3]),
    });
    const ids = recs.map((r) => r.movie.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(100003);
    expect(ids).not.toContain(1);
    expect(ids).not.toContain(2);
    expect(ids).not.toContain(3);
  });

  it('keeps one film per franchise', () => {
    expect(getSeriesKey(9001, 'The Godfather')).toBe(getSeriesKey(9002, 'The Godfather Part II'));
    const r = rng(3);
    const a = candidate(9001, r, 'The Godfather');
    const b = candidate(9002, r, 'The Godfather Part II');
    const recs = rankCandidates([a, b, ...pool], ratings, { serendipityLevel: 30, size: 150 });
    const ids = recs.map((x) => x.movie.id);
    expect(ids.filter((id) => id === 9001 || id === 9002).length).toBeLessThanOrEqual(1);
  });

  it('labels every result with its bucket, sources, an integer score and a reason', () => {
    const recs = rankCandidates(pool, ratings, { serendipityLevel: 60 });
    for (const rec of recs) {
      expect(VALID_BUCKETS).toContain(rec.bucket);
      expect(Array.isArray(rec.sources)).toBe(true);
      expect(Number.isInteger(rec.score)).toBe(true);
      expect(rec.score).toBeGreaterThanOrEqual(0);
      expect(rec.score).toBeLessThanOrEqual(100);
      expect(rec.reason.trim().length).toBeGreaterThan(0);
    }
  });

  it('maps buckets to serendipityType', () => {
    const recs = rankCandidates(pool, ratings, { serendipityLevel: 100, size: 150 });
    for (const rec of recs) {
      if (rec.bucket === 'safe_bet') expect(rec.serendipityType).toBe('safe_bet');
      if (rec.bucket === 'wildcard') expect(rec.serendipityType).toBe('wildcard_discovery');
      if (rec.bucket === 'stretch') {
        expect(rec.serendipityType).toBe(rec.sources?.includes('creator_graph') ? 'director_match' : 'thematic_gem');
      }
    }
    expect(recs.some((r) => r.bucket === 'stretch')).toBe(true);
    expect(recs.some((r) => r.bucket === 'wildcard')).toBe(true);
  });

  it('follows the serendipity level in its bucket mix', () => {
    const count = (level: number, bucket: string) =>
      rankCandidates(pool, ratings, { serendipityLevel: level }).filter((r) => r.bucket === bucket).length;
    expect(count(0, 'safe_bet')).toBeGreaterThan(count(100, 'safe_bet'));
    expect(count(100, 'wildcard')).toBeGreaterThan(count(0, 'wildcard'));
  });

  it('lowers the score of a film close to a rejected one', () => {
    const target: Candidate = {
      ...pool[0],
      movie: { ...pool[0].movie, genres: [{ id: 1, name: 'Drama' }, { id: 2, name: 'Crime' }] },
    };
    const year = target.movie.release_date.slice(0, 4);
    const input = [target, ...pool.slice(1)];
    const scoreOf = (recs: ReturnType<typeof rankCandidates>) => recs.find((r) => r.movie.id === target.movie.id)?.score;
    const before = scoreOf(rankCandidates(input, ratings, { serendipityLevel: 30, size: 150 }));
    const after = scoreOf(
      rankCandidates(input, ratings, {
        serendipityLevel: 30,
        size: 150,
        rejectedFilms: [{ title: 'Rejected', year, genres: ['Drama', 'Crime'] }],
      }),
    );
    expect(before).toBeDefined();
    if (after !== undefined) expect(after).toBeLessThan(before as number);
  });

  it('returns an empty list for an empty pool', () => {
    expect(rankCandidates([], ratings, { serendipityLevel: 30 })).toEqual([]);
  });
});

describe('candidate annotations on pool movies', () => {
  it('round-trips sources and seedNeighbour through Movie[]', () => {
    const pool = heavyPool(20);
    const movies = annotateCandidateMovies(pool);
    expect(movies.map((m) => m.id)).toEqual(pool.map((c) => c.movie.id));
    const back = toCandidates(movies);
    expect(back.map((c) => c.sources)).toEqual(pool.map((c) => c.sources));
    expect(back.map((c) => c.seedNeighbour)).toEqual(pool.map((c) => c.seedNeighbour));
  });

  it('treats plain movies as candidates with no sources', () => {
    const plain = heavyPool(3).map((c) => ({ ...c.movie }) as Movie);
    const cands = toCandidates(plain);
    expect(cands.map((c) => c.sources)).toEqual([[], [], []]);
    expect(cands.map((c) => c.seedNeighbour)).toEqual([false, false, false]);
  });
});

describe('LocalProvider with candidates', () => {
  it('delegates to rankCandidates when the request carries candidates', async () => {
    const ratings = heavyRatings();
    const pool = heavyPool();
    const expected = rankCandidates(pool, ratings, { serendipityLevel: 45 });
    const result = await new LocalProvider().generateRecommendations({
      userRatings: ratings,
      candidatePool: pool.map((c) => c.movie),
      candidates: pool,
      serendipityLevel: 45,
    });
    expect(result.recommendations.map((r) => r.movie.id)).toEqual(expected.map((r) => r.movie.id));
    expect(result.recommendations.every((r) => r.bucket !== undefined)).toBe(true);
  });
});
