import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GroqProvider } from '../groqProvider';
import { GeminiProvider } from '../geminiProvider';
import { OpenRouterProvider, buildOpenRouterPrompt } from '../openRouterProvider';
import {
  estimateTokens,
  candidateCountForBudget,
  getGroqTokenLimit,
  recordGroqTokenLimit,
  resetGroqTokenLimitsForTesting,
  groqLimitSnapshotForTesting,
} from '../promptBudget';
import type { Candidate } from '../../recommendation/types';
import type { RejectedFilm } from '../../recommendation/rejectedFilms';
import type { Movie, UserRating } from '../../../types';
import type { RecommendationRequest } from '../types';

const LETTERS = 'abefghjknopqrstuwyz';

function uniqueTitle(prefix: string, id: number): string {
  const c1 = LETTERS[id % 19];
  const c2 = LETTERS[Math.floor(id / 19) % 19];
  const c3 = LETTERS[Math.floor(id / 361) % 19];
  return `${prefix} ${c1}${c2}${c3}q`;
}

function makeWorstCaseRequest(apiKey: string): RecommendationRequest {
  const userRatings: UserRating[] = Array.from({ length: 80 }, (_, i) => ({
    movieId: 100000 + i,
    title: uniqueTitle('Rated', i + 1),
    rating: i < 50 ? 9 : i < 65 ? 6 : 2,
    posterPath: null,
    year: `${1980 + (i % 40)}`,
    genres: i % 2 === 0 ? ['Drama', 'Thriller'] : ['Sci-Fi', 'Mystery'],
    director: `Director ${LETTERS[i % 19]}q`,
    ratedAt: 1700000000000 + i,
  }));

  const rejectedFilms: RejectedFilm[] = Array.from({ length: 15 }, (_, i) => ({
    title: uniqueTitle('Rejected', i + 1),
    year: `${1990 + (i % 30)}`,
    genres: ['Horror', 'Thriller'],
  }));

  const candidates: Candidate[] = Array.from({ length: 120 }, (_, i) => ({
    movie: {
      id: 1 + i,
      title: uniqueTitle('Candidate', i + 1),
      overview: 'A character-driven atmospheric thriller with unexpected turns.',
      poster_path: null,
      backdrop_path: null,
      release_date: `${1960 + (i % 60)}-05-01`,
      vote_average: 7.2 + ((i % 15) * 0.1),
      vote_count: 150 + i * 100,
      genres: [{ id: 1 + (i % 3), name: i % 3 === 0 ? 'Drama' : i % 3 === 1 ? 'Comedy' : 'Horror' }],
    } as Movie,
    sources: [i % 3 === 0 ? 'seed_graph' : i % 3 === 1 ? 'creator_graph' : 'hidden_gem'],
    seedNeighbour: i % 3 === 0,
  }));

  return {
    userRatings,
    candidatePool: candidates.map((c) => c.movie),
    candidates,
    serendipityLevel: 60,
    selectedVibes: ['Slow Burn', 'Atmospheric'],
    preferredEras: ['1990s', '2000s'],
    rejectedFilms,
    apiKey,
  };
}

function extractPoolEntries(prompt: string): Array<{ id: number; bucket?: string }> {
  const start = prompt.indexOf('Candidate Pool:\n');
  const end = prompt.indexOf('\n\nInstructions:');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const jsonText = prompt.slice(start + 'Candidate Pool:\n'.length, end);
  return JSON.parse(jsonText);
}

function okGroqResponse(tokenLimitHeader: string | null) {
  const content = JSON.stringify({
    taste_analysis: 'Appreciates atmospheric drama and sci-fi.',
    pool_rankings: [
      { id: 1, score: 92, reason: 'Strong match.', serendipityType: 'safe_bet', highlightTags: ['Drama'] },
    ],
    unconstrained_discoveries: [],
  });
  return {
    ok: true,
    headers: new Headers(
      tokenLimitHeader !== null ? { 'x-ratelimit-limit-tokens': tokenLimitHeader } : undefined
    ),
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

describe('Groq adaptive token budget & provider stratified pool (CIN-72)', () => {
  beforeEach(() => {
    resetGroqTokenLimitsForTesting();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sizes the next Groq prompt pool for 8000 TPM on a worst-case prompt so estimateTokens(prompt) + max_tokens <= 8000', async () => {
    const apiKey = 'gsk_free_tier_key_1234567890abcdef';
    const request = makeWorstCaseRequest(apiKey);
    const provider = new GroqProvider();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okGroqResponse('8000'))
      .mockResolvedValueOnce(okGroqResponse('8000'));
    vi.stubGlobal('fetch', fetchMock);

    await provider.generateRecommendations(request);
    await provider.generateRecommendations(request);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getGroqTokenLimit(apiKey)).toBe(8000);

    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const secondPrompt: string = secondBody.messages[1].content;
    const maxTokens: number = secondBody.max_tokens;

    const baseTokens = estimateTokens(
      buildOpenRouterPrompt({ ...request, candidatePool: [] }, { compact: true, poolSize: 0 })
    );
    const expectedPoolSize = candidateCountForBudget({
      tokenLimit: 8000,
      baseTokens,
      replyTokens: maxTokens,
      perCandidateTokens: 40,
      min: 10,
      max: 80,
    });

    const poolEntries = extractPoolEntries(secondPrompt);
    expect(poolEntries).toHaveLength(expectedPoolSize);
    expect(expectedPoolSize).toBeGreaterThanOrEqual(10);
    expect(expectedPoolSize).toBeLessThan(60);
    expect(poolEntries.every((entry) => typeof entry.bucket === 'string')).toBe(true);
    expect(secondPrompt).toContain('Genre Summary (all 80 ratings, 30 omitted above)');
    expect(secondPrompt).toContain('Recently rejected films');
    expect(secondPrompt).toContain(request.rejectedFilms![14].title);
    expect(estimateTokens(secondPrompt) + maxTokens).toBeLessThanOrEqual(8000);

    const snapshot = JSON.stringify(groqLimitSnapshotForTesting());
    for (let i = 0; i + 6 <= apiKey.length; i++) {
      expect(snapshot).not.toContain(apiKey.slice(i, i + 6));
    }
  });

  it('expands the next Groq prompt pool up to 80 candidates when x-ratelimit-limit-tokens is 30000', async () => {
    const apiKey = 'gsk_paid_tier_key_9876543210fedcba';
    const request = makeWorstCaseRequest(apiKey);
    const provider = new GroqProvider();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okGroqResponse('30000'))
      .mockResolvedValueOnce(okGroqResponse('30000'));
    vi.stubGlobal('fetch', fetchMock);

    await provider.generateRecommendations(request);
    await provider.generateRecommendations(request);

    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const firstPool = extractPoolEntries(firstBody.messages[1].content);
    const secondPool = extractPoolEntries(secondBody.messages[1].content);

    expect(getGroqTokenLimit(apiKey)).toBe(30000);
    expect(secondPool.length).toBeGreaterThan(firstPool.length);
    expect(secondPool).toHaveLength(80);

    const snapshot = JSON.stringify(groqLimitSnapshotForTesting());
    for (let i = 0; i + 6 <= apiKey.length; i++) {
      expect(snapshot).not.toContain(apiKey.slice(i, i + 6));
    }
  });

  it('records x-ratelimit-limit-tokens even when Groq returns an error response', async () => {
    const apiKey = 'gsk_error_header_key_abcdef123456';
    const request = makeWorstCaseRequest(apiKey);
    const provider = new GroqProvider();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({ 'x-ratelimit-limit-tokens': '30000' }),
        json: async () => ({ error: { message: 'Rate limit exceeded' } }),
      })
      .mockResolvedValueOnce(okGroqResponse('30000'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(provider.generateRecommendations(request)).rejects.toThrow(/Groq API error/);
    expect(getGroqTokenLimit(apiKey)).toBe(30000);

    await provider.generateRecommendations(request);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(extractPoolEntries(secondBody.messages[1].content)).toHaveLength(80);
  });

  it('sends a 60-candidate stratified pool with buckets for Gemini and OpenRouter when candidates exist, and preserves legacy prompts without candidates', async () => {
    const request = makeWorstCaseRequest('test-provider-key');

    const geminiFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    taste_analysis: 'Eclectic taste.',
                    pool_rankings: [
                      { id: 1, score: 90, reason: 'Solid bridge.', serendipityType: 'safe_bet', highlightTags: ['Drama'] },
                    ],
                    unconstrained_discoveries: [],
                  }),
                },
              ],
            },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', geminiFetch);

    const gemini = new GeminiProvider();
    await gemini.generateRecommendations(request);
    const geminiPromptWithCandidates: string = JSON.parse(geminiFetch.mock.calls[0][1].body)
      .contents[0].parts[0].text;
    const geminiPool = extractPoolEntries(geminiPromptWithCandidates);
    expect(geminiPool).toHaveLength(60);
    expect(geminiPool.every((item) => typeof item.bucket === 'string')).toBe(true);
    expect(geminiPromptWithCandidates).toContain('safe_bet');
    expect(geminiPromptWithCandidates).toContain('stretch');
    expect(geminiPromptWithCandidates).toContain('wildcard');
    expect(geminiPromptWithCandidates).toContain('below_floor');
    expect(geminiPromptWithCandidates).toContain('bridge');
    expect(geminiPromptWithCandidates).toContain('12–30');

    const withoutCandidates = { ...request, candidates: undefined };
    await gemini.generateRecommendations(withoutCandidates);
    const geminiPromptWithoutCandidates: string = JSON.parse(geminiFetch.mock.calls[1][1].body)
      .contents[0].parts[0].text;
    const legacyGeminiPool = extractPoolEntries(geminiPromptWithoutCandidates);
    expect(legacyGeminiPool).toHaveLength(40);
    expect(legacyGeminiPool.every((item) => item.bucket === undefined)).toBe(true);
    expect(geminiPromptWithoutCandidates).not.toContain('below_floor');

    const openRouterFetch = vi.fn().mockResolvedValue(okGroqResponse(null));
    vi.stubGlobal('fetch', openRouterFetch);

    const openRouter = new OpenRouterProvider();
    await openRouter.generateRecommendations(request);
    const openRouterPrompt: string = JSON.parse(openRouterFetch.mock.calls[0][1].body).messages[1].content;
    const openRouterPool = extractPoolEntries(openRouterPrompt);
    expect(openRouterPool).toHaveLength(60);
    expect(openRouterPool.every((item) => typeof item.bucket === 'string')).toBe(true);
    expect(openRouterPrompt).toContain('12–30');
    expect(openRouterPrompt).toContain('below_floor');
  });

  it('guards non-finite budget inputs and bounds in-memory key tracking', () => {
    expect(
      candidateCountForBudget({
        tokenLimit: 8000,
        baseTokens: Number.NaN,
        replyTokens: 4000,
        perCandidateTokens: 40,
        min: 10,
        max: 80,
      })
    ).toBe(10);

    expect(
      candidateCountForBudget({
        tokenLimit: 8000,
        baseTokens: 3000,
        replyTokens: Number.NaN,
        perCandidateTokens: 40,
        min: 10,
        max: 80,
      })
    ).toBe(10);

    expect(
      candidateCountForBudget({
        tokenLimit: 8000,
        baseTokens: 3000,
        replyTokens: 4000,
        perCandidateTokens: 0,
        min: 10,
        max: 80,
      })
    ).toBe(10);

    for (let i = 0; i < 300; i++) {
      recordGroqTokenLimit(`gsk_key_${i}_abcdef`, '30000');
    }
    expect(groqLimitSnapshotForTesting().length).toBeLessThanOrEqual(256);
  });
});
