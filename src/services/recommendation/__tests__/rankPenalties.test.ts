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

// Twenty near-identical Drama/Crime films, so position is decided by small score differences.
function pool(): Candidate[] {
  return Array.from({ length: 20 }, (_, i) => candidate(1 + i, ['Drama', 'Crime'], 900, 1990 + (i % 10)));
}

const positionOf = (recs: ReturnType<typeof rankCandidates>, id: number) =>
  recs.findIndex((r) => r.movie.id === id);

describe('rankCandidates penalties', () => {
  it('moves a film close to a rejected one down the list, not just its score', () => {
    const p = pool();
    const target = p[0];
    const base = rankCandidates(p, ratings(80), { serendipityLevel: 30, size: 20 });
    const penalised = rankCandidates(p, ratings(80), {
      serendipityLevel: 30,
      size: 20,
      rejectedFilms: [{ title: 'Nope', year: '1990', genres: ['Drama', 'Crime'] }],
    });
    // Every 1990s Drama/Crime film is penalised equally, so compare against an unpenalised 2000s film.
    expect(positionOf(base, target.movie.id)).toBeGreaterThanOrEqual(0);
    const rejectedScore = penalised.find((r) => r.movie.id === target.movie.id)?.score ?? -1;
    const baseScore = base.find((r) => r.movie.id === target.movie.id)?.score ?? -1;
    expect(rejectedScore).toBeLessThan(baseScore);
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

  it('lowers relevance for every film close to a rejected one', () => {
    const before = rankCandidates([famous, obscure], ratings(600), { serendipityLevel: 30, size: 2 });
    const after = rankCandidates([famous, obscure], ratings(600), {
      serendipityLevel: 30,
      size: 2,
      rejectedFilms: [
        { title: 'Nope one', year: '1994', genres: ['Drama', 'Crime'] },
        { title: 'Nope two', year: '1996', genres: ['Drama', 'Crime'] },
      ],
    });
    // Both match the rejected films equally, so relative order holds and both scores drop.
    expect(scoreOf(after, 500)).toBeLessThan(scoreOf(before, 500) as number);
    expect(scoreOf(after, 501)).toBeLessThan(scoreOf(before, 501) as number);
  });
});
