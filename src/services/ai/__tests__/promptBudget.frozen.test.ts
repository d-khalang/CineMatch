import { describe, it, expect, beforeEach } from 'vitest';
import {
  estimateTokens,
  candidateCountForBudget,
  recordGroqTokenLimit,
  getGroqTokenLimit,
  resetGroqTokenLimitsForTesting,
  groqLimitSnapshotForTesting,
  GROQ_FREE_TIER_TOKENS_PER_MINUTE,
} from '../promptBudget';
import { buildOpenRouterPrompt } from '../openRouterProvider';
import type { Candidate } from '../../recommendation/types';
import type { Movie, UserRating } from '../../../types';

// Frozen spec for CIN-72 (pool size per provider, adaptive Groq budget). Do not edit.

describe('estimateTokens', () => {
  it('is zero for empty text and grows with length', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a'.repeat(350))).toBeGreaterThan(estimateTokens('a'.repeat(35)));
  });

  it('errs on the high side (about one token per 3.5 characters, rounded up)', () => {
    expect(estimateTokens('a'.repeat(7))).toBe(2);
    expect(estimateTokens('a'.repeat(8))).toBe(3);
    expect(estimateTokens('a'.repeat(3500))).toBe(1000);
  });
});

describe('candidateCountForBudget', () => {
  const base = { baseTokens: 3000, replyTokens: 4000, perCandidateTokens: 40, min: 10, max: 80 };

  it('fits the free tier: (8000 - 3000 - 4000 - 200 safety) / 40 = 20', () => {
    expect(candidateCountForBudget({ ...base, tokenLimit: 8000 })).toBe(20);
  });

  it('gives a paid key a larger pool, capped at max', () => {
    expect(candidateCountForBudget({ ...base, tokenLimit: 12000 })).toBe(80);
    expect(candidateCountForBudget({ ...base, tokenLimit: 300000 })).toBe(80);
    expect(candidateCountForBudget({ ...base, tokenLimit: 9000 })).toBe(45);
  });

  it('never goes below min, even when the budget is already spent', () => {
    expect(candidateCountForBudget({ ...base, tokenLimit: 6000 })).toBe(10);
  });

  it('treats an invalid limit as the free tier', () => {
    expect(candidateCountForBudget({ ...base, tokenLimit: Number.NaN })).toBe(20);
    expect(candidateCountForBudget({ ...base, tokenLimit: -1 })).toBe(20);
  });
});

describe('Groq token limit memory', () => {
  const keyA = 'gsk_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const keyB = 'gsk_test_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  beforeEach(() => resetGroqTokenLimitsForTesting());

  it('defaults to the free tier', () => {
    expect(GROQ_FREE_TIER_TOKENS_PER_MINUTE).toBe(8000);
    expect(getGroqTokenLimit(keyA)).toBe(8000);
  });

  it('remembers the header value per key', () => {
    recordGroqTokenLimit(keyA, '30000');
    expect(getGroqTokenLimit(keyA)).toBe(30000);
    expect(getGroqTokenLimit(keyB)).toBe(8000);
  });

  it('ignores missing or invalid header values', () => {
    recordGroqTokenLimit(keyA, '30000');
    recordGroqTokenLimit(keyA, null);
    recordGroqTokenLimit(keyA, 'abc');
    recordGroqTokenLimit(keyA, '-5');
    expect(getGroqTokenLimit(keyA)).toBe(30000);
  });

  it('never keeps the key itself, or any 6-character piece of it, in memory', () => {
    recordGroqTokenLimit(keyA, '30000');
    const snapshot = JSON.stringify(groqLimitSnapshotForTesting());
    for (let i = 0; i + 6 <= keyA.length; i++) {
      expect(snapshot).not.toContain(keyA.slice(i, i + 6));
    }
  });
});

describe('buildOpenRouterPrompt with candidates', () => {
  const ratings: UserRating[] = Array.from({ length: 30 }, (_, i) => ({
    movieId: 100000 + i,
    title: `Rated ${i}`,
    rating: 8,
    posterPath: null,
    genres: ['Drama'],
    ratedAt: i,
  })) as UserRating[];

  const letters = 'abefghjknopqrstuwyz';
  const title = (id: number) => `Film ${letters[id % 19]}${letters[Math.floor(id / 19) % 19]}${letters[Math.floor(id / 361) % 19]}q`;
  const candidates: Candidate[] = Array.from({ length: 120 }, (_, i) => ({
    movie: {
      id: 1 + i,
      title: title(1 + i),
      overview: 'x',
      poster_path: null,
      backdrop_path: null,
      release_date: `${1960 + (i % 60)}-01-01`,
      vote_average: 7,
      vote_count: 100 + i * 50,
      genres: [{ id: 1, name: i % 3 === 0 ? 'Drama' : i % 3 === 1 ? 'Comedy' : 'Horror' }],
    } as Movie,
    sources: ['seed_graph'],
    seedNeighbour: false,
  }));
  const request = {
    userRatings: ratings,
    candidatePool: candidates.map((c) => c.movie),
    candidates,
    serendipityLevel: 60,
  };

  const poolIds = (prompt: string) => {
    const section = prompt.slice(prompt.indexOf('Candidate Pool:'), prompt.indexOf('Instructions:'));
    return [...section.matchAll(/"id":\s*(\d+)/g)].map((m) => Number(m[1]));
  };

  it('sends poolSize candidates chosen by the pipeline, each with its bucket', () => {
    const prompt = buildOpenRouterPrompt(request, { poolSize: 60 });
    const ids = poolIds(prompt);
    expect(ids).toHaveLength(60);
    expect(new Set(ids).size).toBe(60);
    const section = prompt.slice(prompt.indexOf('Candidate Pool:'), prompt.indexOf('Instructions:'));
    expect(section).toMatch(/"bucket":\s*"(safe_bet|stretch|wildcard)"/);
    expect(section).toMatch(/"bucket":\s*"stretch"/);
  });

  it('honours a smaller pool for Groq', () => {
    expect(poolIds(buildOpenRouterPrompt(request, { compact: true, poolSize: 20 }))).toHaveLength(20);
  });

  it('is unchanged when the request has no candidates', () => {
    const withoutCandidates = { ...request, candidates: undefined };
    expect(buildOpenRouterPrompt(withoutCandidates, { poolSize: 60 })).toBe(buildOpenRouterPrompt(withoutCandidates));
    expect(poolIds(buildOpenRouterPrompt(withoutCandidates))).toHaveLength(40);
  });
});
