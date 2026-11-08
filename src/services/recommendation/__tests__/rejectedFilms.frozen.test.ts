import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  selectRejectedFilms,
  formatRejectedFilmsBlock,
  rejectionPenalty,
  type RejectedFilm,
} from '../rejectedFilms';
import { buildOpenRouterPrompt } from '../../ai/openRouterProvider';
import { GeminiProvider } from '../../ai/geminiProvider';
import { GroqProvider } from '../../ai/groqProvider';
import { LocalProvider } from '../../ai/localProvider';
import type { HiddenFilm, Movie, UserRating } from '../../../types';

const hidden = (over: Partial<HiddenFilm> & { movieId: number }): HiddenFilm => ({
  reason: 'not_for_me',
  hiddenAt: over.movieId,
  title: `Film ${over.movieId}`,
  ...over,
});

const movie = (id: number, genres: string[], date: string, vote = 7): Movie =>
  ({
    id,
    title: `Candidate ${id}`,
    overview: 'A film.',
    release_date: date,
    vote_average: vote,
    vote_count: 1000,
    poster_path: null,
    backdrop_path: null,
    genres: genres.map((name, i) => ({ id: i + 1, name })),
  }) as Movie;

const rating = (id: number, genres: string[], value = 8): UserRating =>
  ({
    movieId: id,
    title: `Rated ${id}`,
    rating: value,
    posterPath: null,
    genres,
    ratedAt: id,
  }) as UserRating;

const rejected: RejectedFilm = {
  title: 'The Rejected One',
  year: '1994',
  genres: ['Drama', 'Thriller'],
};

const baseRequest = {
  userRatings: [rating(1, ['Drama'])],
  candidatePool: [movie(10, ['Drama', 'Thriller'], '1995-01-01')],
  serendipityLevel: 30,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('selectRejectedFilms (frozen)', () => {
  it('keeps only "not for me" films; "seen" stays neutral', () => {
    const result = selectRejectedFilms([
      hidden({ movieId: 1, reason: 'seen' }),
      hidden({ movieId: 2 }),
    ]);

    expect(result.map((r) => r.title)).toEqual(['Film 2']);
  });

  it('returns the most recent first and caps at 15 by default', () => {
    const list = Array.from({ length: 20 }, (_, i) => hidden({ movieId: i + 1 }));

    const result = selectRejectedFilms(list);

    expect(result).toHaveLength(15);
    expect(result[0].title).toBe('Film 20');
    expect(result[14].title).toBe('Film 6');
  });

  it('honours a custom limit', () => {
    const list = [hidden({ movieId: 1 }), hidden({ movieId: 2 })];

    expect(selectRejectedFilms(list, 1).map((r) => r.title)).toEqual(['Film 2']);
  });

  it('skips films with no usable title, including the "#123" placeholder', () => {
    const result = selectRejectedFilms([
      hidden({ movieId: 1, title: undefined }),
      hidden({ movieId: 2, title: '#2' }),
      hidden({ movieId: 3, title: '   ' }),
      hidden({ movieId: 4 }),
    ]);

    expect(result.map((r) => r.title)).toEqual(['Film 4']);
  });

  it('carries year and genres when the hidden film has them', () => {
    const [film] = selectRejectedFilms([
      hidden({ movieId: 1, year: '1994', genres: ['Drama'] }),
    ]);

    expect(film).toEqual({ title: 'Film 1', year: '1994', genres: ['Drama'] });
  });
});

describe('formatRejectedFilmsBlock (frozen)', () => {
  it('is empty when nothing was rejected, so prompts do not change', () => {
    expect(formatRejectedFilmsBlock([])).toBe('');
  });

  it('names the film, year and genres and asks to avoid close neighbours', () => {
    const block = formatRejectedFilmsBlock([rejected]);

    expect(block).toContain('Recently rejected');
    expect(block).toContain('The Rejected One');
    expect(block).toContain('1994');
    expect(block).toContain('Drama');
    expect(block.toLowerCase()).toContain('avoid');
  });

  it('works without year or genres', () => {
    expect(formatRejectedFilmsBlock([{ title: 'Bare Title' }])).toContain('Bare Title');
  });

  it('stays small enough for the free-tier prompt budget at 15 films', () => {
    const films = Array.from({ length: 15 }, (_, i) => ({
      title: `A Fairly Typical Film Title ${i}`,
      year: '1994',
      genres: ['Drama', 'Thriller', 'Science Fiction', 'Romance', 'Comedy'],
    }));

    expect(formatRejectedFilmsBlock(films).length).toBeLessThan(1500);
  });
});

describe('rejectionPenalty (frozen)', () => {
  const near = movie(1, ['Drama', 'Thriller'], '1995-06-01');

  it('is 0 with no rejected films', () => {
    expect(rejectionPenalty(near, [])).toBe(0);
  });

  it('applies when a candidate shares two genres and the decade', () => {
    expect(rejectionPenalty(near, [rejected])).toBeGreaterThan(0);
  });

  it('ignores genre case', () => {
    const lower = movie(1, ['drama', 'THRILLER'], '1995-06-01');

    expect(rejectionPenalty(lower, [rejected])).toBeGreaterThan(0);
  });

  it('is 0 with only one shared genre', () => {
    expect(rejectionPenalty(movie(1, ['Drama', 'Comedy'], '1995-06-01'), [rejected])).toBe(0);
  });

  it('is 0 in a different decade', () => {
    expect(rejectionPenalty(movie(1, ['Drama', 'Thriller'], '2005-06-01'), [rejected])).toBe(0);
  });

  it('is 0 when the rejected film has no year or genres, or the candidate has no date', () => {
    expect(rejectionPenalty(near, [{ title: 'Bare' }])).toBe(0);
    expect(rejectionPenalty(movie(1, ['Drama', 'Thriller'], ''), [rejected])).toBe(0);
  });

  it('stays mild: one match is at most 8 points and many matches at most 12', () => {
    expect(rejectionPenalty(near, [rejected])).toBeLessThanOrEqual(8);
    expect(rejectionPenalty(near, Array(15).fill(rejected))).toBeLessThanOrEqual(12);
  });
});

describe('Prompts carry the rejected films (frozen)', () => {
  const okFetch = (body: unknown) => vi.fn().mockResolvedValue({ ok: true, json: async () => body });

  it('OpenRouter includes the block, in both pretty and compact form', () => {
    const request = { ...baseRequest, rejectedFilms: [rejected] };

    expect(buildOpenRouterPrompt(request)).toContain('The Rejected One');
    expect(buildOpenRouterPrompt(request, { compact: true })).toContain('The Rejected One');
  });

  it('OpenRouter is unchanged when nothing was rejected', () => {
    expect(buildOpenRouterPrompt({ ...baseRequest, rejectedFilms: [] })).toBe(
      buildOpenRouterPrompt(baseRequest)
    );
  });

  it('Groq sends the block', async () => {
    const fetchMock = okFetch({
      choices: [
        {
          finish_reason: 'stop',
          message: { content: JSON.stringify({ taste_analysis: 'x', pool_rankings: [] }) },
        },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    await new GroqProvider().generateRecommendations({
      ...baseRequest,
      rejectedFilms: [rejected],
      apiKey: 'test-key',
    });

    expect(fetchMock.mock.calls[0][1].body).toContain('The Rejected One');
  });

  it('Gemini sends the block', async () => {
    const fetchMock = okFetch({
      candidates: [
        { content: { parts: [{ text: JSON.stringify({ taste_analysis: 'x', pool_rankings: [] }) }] } },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    await new GeminiProvider().generateRecommendations({
      ...baseRequest,
      rejectedFilms: [rejected],
      apiKey: 'test-key',
    });

    expect(fetchMock.mock.calls[0][1].body).toContain('The Rejected One');
  });
});

describe('Local provider demotes close neighbours (frozen)', () => {
  const provider = new LocalProvider();
  const pool = [
    movie(10, ['Drama', 'Thriller'], '1995-01-01', 7),
    movie(11, ['Drama', 'Comedy'], '2015-01-01', 7),
  ];
  const request = {
    userRatings: [rating(1, ['Drama'], 9), rating(2, ['Thriller'], 7)],
    candidatePool: pool,
    serendipityLevel: 30,
  };
  const scoreOf = (recs: { movie: Movie; score: number }[], id: number) =>
    recs.find((r) => r.movie.id === id)?.score;

  it('lowers the score of a close neighbour and leaves other films alone', async () => {
    const before = await provider.generateRecommendations(request);
    const after = await provider.generateRecommendations({ ...request, rejectedFilms: [rejected] });

    expect(scoreOf(after.recommendations, 10)).toBeLessThan(scoreOf(before.recommendations, 10)!);
    expect(scoreOf(after.recommendations, 11)).toBe(scoreOf(before.recommendations, 11));
  });

  it('demotes but never excludes', async () => {
    const after = await provider.generateRecommendations({
      ...request,
      rejectedFilms: Array(15).fill(rejected),
    });

    expect(after.recommendations.map((r) => r.movie.id)).toContain(10);
  });

  it('keeps ranks consistent with the demoted scores', async () => {
    const after = await provider.generateRecommendations({
      ...request,
      rejectedFilms: Array(15).fill(rejected),
    });
    const scores = after.recommendations.map((r) => r.score);

    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(after.recommendations.map((r) => r.rank)).toEqual(scores.map((_, i) => i + 1));
  });
});
