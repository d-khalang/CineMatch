import { describe, it, expect } from 'vitest';
import { rankCandidates } from '../rankCandidates';
import type { Candidate } from '../types';
import type { Movie, UserRating } from '../../../types';

// Penalties must change a film's position in the ranked list, not only its displayed score.

const LETTERS = 'abefghjknopqrstuwyz';
const title = (id: number) => {
  let n = id;
  let w = '';
  do {
    w = LETTERS[n % LETTERS.length] + w;
    n = Math.floor(n / LETTERS.length);
  } while (n > 0);
  return `Film ${w}q`;
};

function candidate(id: number, genres: string[], voteCount: number, year = 1995): Candidate {
  return {
    movie: {
      id,
      title: title(id),
      overview: '',
      poster_path: null,
      backdrop_path: null,
      release_date: `${year}-06-01`,
      vote_average: 7.4,
      vote_count: voteCount,
      genres: genres.map((name, i) => ({ id: i + 1, name })),
    } as Movie,
    sources: ['seed_graph'],
    seedNeighbour: true,
  };
}

function ratings(n: number): UserRating[] {
  return Array.from({ length: n }, (_, i) => ({
    movieId: 100000 + i,
    title: `Rated ${i}`,
    rating: i % 4 === 3 ? 4 : 9,
    posterPath: null,
    genres: i % 2 === 0 ? ['Drama', 'Crime'] : ['Drama', 'Thriller'],
    year: String(1980 + (i % 40)),
    ratedAt: i,
  })) as UserRating[];
}


const positionOf = (recs: ReturnType<typeof rankCandidates>, id: number) =>
  recs.findIndex((r) => r.movie.id === id);

describe('rankCandidates penalties', () => {
  it('moves a film close to a rejected one down the list, not just its score', () => {
    // Eight Drama/Crime films, one per decade, so a rejected film matches exactly one of them.
    const years = [1975, 1985, 1995, 2005, 2015, 1965, 1955, 2022];
    const decades = years.map((year, i) => candidate(1 + i, ['Drama', 'Crime'], 900, year));
    const base = rankCandidates(decades, ratings(80), { serendipityLevel: 30, size: 8 });
    const top = base[0];
    const after = rankCandidates(decades, ratings(80), {
      serendipityLevel: 30,
      size: 8,
      rejectedFilms: [{ title: 'Nope', year: top.movie.release_date.slice(0, 4), genres: ['Drama', 'Crime'] }],
    });
    expect(positionOf(after, top.movie.id)).toBeGreaterThan(0);
    expect(after[0].movie.id).not.toBe(top.movie.id);
    // Only the matching film is penalised; every other film keeps its bucket.
    for (const rec of after) {
      if (rec.movie.id !== top.movie.id) {
        expect(rec.bucket).toBe(base.find((r) => r.movie.id === rec.movie.id)?.bucket);
      }
    }
  });

  const famous = candidate(500, ['Drama', 'Crime'], 2_000_000, 1995);
  const obscure = candidate(501, ['Drama', 'Crime'], 900, 1995);
  const scoreOf = (recs: ReturnType<typeof rankCandidates>, id: number) => recs.find((r) => r.movie.id === id)?.score;

  it('lowers a famous film\'s relevance for a heavy rater at high serendipity', () => {
    const recs = rankCandidates([famous, obscure], ratings(600), { serendipityLevel: 90, size: 2 });
    expect(scoreOf(recs, 500)).toBeLessThan(scoreOf(recs, 501) as number);
  });

  it('applies no fame penalty at low serendipity or for a new user', () => {
    const low = rankCandidates([famous, obscure], ratings(600), { serendipityLevel: 30, size: 2 });
    expect(scoreOf(low, 500)).toBe(scoreOf(low, 501));
    const newUser = rankCandidates([famous, obscure], ratings(20), { serendipityLevel: 90, size: 2 });
    expect(scoreOf(newUser, 500)).toBe(scoreOf(newUser, 501));
  });
});
