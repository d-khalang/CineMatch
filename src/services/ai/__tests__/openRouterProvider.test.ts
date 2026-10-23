import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildOpenRouterPrompt, OpenRouterProvider } from '../openRouterProvider';
import { Movie, UserRating } from '../../../types';

function makeRating(index: number, rating: number, genres: string[] = ['Drama']): UserRating {
  return {
    movieId: index,
    title: `Film_${index}_R${rating}`,
    rating,
    posterPath: null,
    year: '2020',
    genres,
    director: `Director ${index}`,
    ratedAt: 1700000000000 + index,
  };
}

function makeCandidate(id: number): Movie {
  return {
    id,
    title: `Candidate ${id}`,
    overview: 'Overview',
    poster_path: null,
    backdrop_path: null,
    release_date: '2021-05-01',
    vote_average: 7.5,
    vote_count: 400,
    genres: [{ id: 18, name: 'Drama' }],
  };
}

function extractUserProfileArray(prompt: string): Array<{ title: string; user_rating: string }> {
  const marker = 'User Profile:\n';
  const start = prompt.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const afterMarker = prompt.slice(start + marker.length);
  if (afterMarker.startsWith('[]')) {
    return [];
  }
  const endBracket = afterMarker.indexOf('\n]');
  expect(endBracket).toBeGreaterThanOrEqual(0);
  const jsonText = afterMarker.slice(0, endBracket + 2);
  return JSON.parse(jsonText);
}

describe('buildOpenRouterPrompt (CIN-33)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('AC1 & AC3: states 12–20 pool_rankings, up to 3 discoveries, serendipity rubric with active band, bridge/risk reason, and allowed serendipityType values', () => {
    const baseRequest = {
      userRatings: [makeRating(1, 9, ['Sci-Fi'])],
      candidatePool: [makeCandidate(101)],
      selectedVibes: ['Slow Burn'],
      preferredEras: ['1970s'],
    };

    const lowPrompt = buildOpenRouterPrompt({ ...baseRequest, serendipityLevel: 20 });
    expect(lowPrompt).toContain('12–20');
    expect(lowPrompt).toContain('pool_rankings');
    expect(lowPrompt).toContain('up to 3');
    expect(lowPrompt).toContain('unconstrained_discoveries');
    expect(lowPrompt).toContain("- 0–30% [ACTIVE]: mostly close matches to the user's taste.");
    expect(lowPrompt).toContain('- 31–70%: a mix, with some films from adjacent genres or creators.');
    expect(lowPrompt).toContain(
      '- 71–100%: mostly films the user would not pick themselves, but with a clear bridge to their taste.'
    );

    const midPrompt = buildOpenRouterPrompt({ ...baseRequest, serendipityLevel: 50 });
    expect(midPrompt).toContain("- 0–30%: mostly close matches to the user's taste.");
    expect(midPrompt).toContain('- 31–70% [ACTIVE]: a mix, with some films from adjacent genres or creators.');
    expect(midPrompt).toContain(
      '- 71–100%: mostly films the user would not pick themselves, but with a clear bridge to their taste.'
    );

    const highPrompt = buildOpenRouterPrompt({ ...baseRequest, serendipityLevel: 85 });
    expect(highPrompt).toContain('Serendipity: 85%');
    expect(highPrompt).toContain("- 0–30%: mostly close matches to the user's taste.");
    expect(highPrompt).toContain('- 31–70%: a mix, with some films from adjacent genres or creators.');
    expect(highPrompt).toContain(
      '- 71–100% [ACTIVE]: mostly films the user would not pick themselves, but with a clear bridge to their taste.'
    );

    // AC3: bridge and why the risk is worth it for non-safe picks
    expect(highPrompt).toMatch(/bridge/i);
    expect(highPrompt).toMatch(/why the risk is worth it/i);

    // Allowed serendipityType values
    for (const allowedType of [
      'safe_bet',
      'thematic_gem',
      'director_match',
      'wildcard_discovery',
      'ai_cinephile_discovery',
    ]) {
      expect(highPrompt).toContain(allowedType);
    }
  });

  it('AC2: with 300 ratings, includes exactly 80 rated titles (top 60 and bottom 20) plus a one-line genre summary across all ratings', () => {
    const ratings: UserRating[] = [];
    // Create 300 ratings in mixed order:
    // - 60 high ratings (rating 9 or 10)
    // - 220 middle ratings (rating 5 or 6)
    // - 20 low ratings (rating 1 or 2)
    for (let i = 1; i <= 220; i++) {
      ratings.push(makeRating(i, i % 2 === 0 ? 6 : 5, ['Drama', 'Mystery']));
    }
    for (let i = 221; i <= 280; i++) {
      ratings.push(makeRating(i, i % 2 === 0 ? 10 : 9, ['Sci-Fi']));
    }
    for (let i = 281; i <= 300; i++) {
      ratings.push(makeRating(i, i % 2 === 0 ? 2 : 1, ['Horror']));
    }

    const originalOrderIds = ratings.map((r) => r.movieId);

    const prompt = buildOpenRouterPrompt({
      userRatings: ratings,
      candidatePool: [makeCandidate(101)],
      serendipityLevel: 85,
    });

    // Does not mutate input array
    expect(ratings.map((r) => r.movieId)).toEqual(originalOrderIds);

    const profileItems = extractUserProfileArray(prompt);
    expect(profileItems).toHaveLength(80);

    // First 60 are the 60 highest-rated (9/10 and 10/10)
    const top60 = profileItems.slice(0, 60);
    expect(top60.every((item) => item.user_rating === '10/10' || item.user_rating === '9/10')).toBe(true);

    // Last 20 are the 20 lowest-rated (1/10 and 2/10)
    const bottom20 = profileItems.slice(60, 80);
    expect(bottom20.every((item) => item.user_rating === '2/10' || item.user_rating === '1/10')).toBe(true);

    // None of the 220 middle ratings (5/10 or 6/10) appear in the prompt
    expect(profileItems.some((item) => item.user_rating === '5/10' || item.user_rating === '6/10')).toBe(false);

    // One-line genre summary across all 300 ratings: Drama: 220, Mystery: 220, Sci-Fi: 60, Horror: 20
    const summaryLines = prompt.split('\n').filter((line) => line.startsWith('Genre Summary'));
    expect(summaryLines).toHaveLength(1);
    expect(summaryLines[0]).toContain('Drama: 220');
    expect(summaryLines[0]).toContain('Mystery: 220');
    expect(summaryLines[0]).toContain('Sci-Fi: 60');
    expect(summaryLines[0]).toContain('Horror: 20');
  });

  it('AC2: with 50 ratings, includes all 50 rated titles without truncation', () => {
    const ratings = Array.from({ length: 50 }, (_, i) =>
      makeRating(i + 1, (i % 10) + 1, ['Drama'])
    );

    const prompt = buildOpenRouterPrompt({
      userRatings: ratings,
      candidatePool: [makeCandidate(101)],
      serendipityLevel: 30,
    });

    const profileItems = extractUserProfileArray(prompt);
    expect(profileItems).toHaveLength(50);
    expect(profileItems.map((p) => p.title)).toEqual(ratings.map((r) => r.title));
    expect(prompt).not.toContain('Genre Summary');
  });

  it('handles edge cases: empty inputs, single rating, exact 80/81 boundary, rubric boundaries, and NaN values', () => {
    // Empty ratings and pool, NaN serendipityLevel falls back to 30% (low band)
    const emptyPrompt = buildOpenRouterPrompt({
      userRatings: [],
      candidatePool: [],
      serendipityLevel: Number.NaN,
    });
    expect(extractUserProfileArray(emptyPrompt)).toEqual([]);
    expect(emptyPrompt).not.toContain('Genre Summary');
    expect(emptyPrompt).toContain('Serendipity: 30%');
    expect(emptyPrompt).toContain("- 0–30% [ACTIVE]: mostly close matches to the user's taste.");

    // Single rating
    const singlePrompt = buildOpenRouterPrompt({
      userRatings: [makeRating(1, 8, ['Thriller'])],
      candidatePool: [makeCandidate(1)],
      serendipityLevel: 0,
    });
    expect(extractUserProfileArray(singlePrompt)).toHaveLength(1);
    expect(singlePrompt).not.toContain('Genre Summary');
    expect(singlePrompt).toContain("- 0–30% [ACTIVE]: mostly close matches to the user's taste.");

    // Rubric exact boundaries: 30 (low), 31 (mid), 70 (mid), 71 (high), 100 (high)
    for (const [level, expectedLine] of [
      [30, "- 0–30% [ACTIVE]: mostly close matches to the user's taste."],
      [31, '- 31–70% [ACTIVE]: a mix, with some films from adjacent genres or creators.'],
      [70, '- 31–70% [ACTIVE]: a mix, with some films from adjacent genres or creators.'],
      [71, '- 71–100% [ACTIVE]: mostly films the user would not pick themselves, but with a clear bridge to their taste.'],
      [100, '- 71–100% [ACTIVE]: mostly films the user would not pick themselves, but with a clear bridge to their taste.'],
    ] as const) {
      const p = buildOpenRouterPrompt({
        userRatings: [],
        candidatePool: [],
        serendipityLevel: level,
      });
      expect(p).toContain(expectedLine);
    }

    // Exact 80 boundary: not truncated
    const ratings80 = Array.from({ length: 80 }, (_, i) => makeRating(i + 1, 7, ['Drama']));
    const prompt80 = buildOpenRouterPrompt({
      userRatings: ratings80,
      candidatePool: [],
      serendipityLevel: 50,
    });
    expect(extractUserProfileArray(prompt80)).toHaveLength(80);
    expect(prompt80).not.toContain('Genre Summary');

    // 81 ratings with a NaN rating: truncated to 80 (top 60 + bottom 20) with genre summary
    const ratings81 = [
      ...Array.from({ length: 60 }, (_, i) => makeRating(i + 1, 9, ['Action'])),
      makeRating(61, 5, ['Comedy']),
      ...Array.from({ length: 19 }, (_, i) => makeRating(i + 62, 2, ['Horror'])),
      makeRating(81, Number.NaN, ['Horror']),
    ];
    const prompt81 = buildOpenRouterPrompt({
      userRatings: ratings81,
      candidatePool: [],
      serendipityLevel: 50,
    });
    const profile81 = extractUserProfileArray(prompt81);
    expect(profile81).toHaveLength(80);
    expect(profile81.some((item) => item.title === 'Film_61_R5')).toBe(false);
    expect(prompt81).toContain('Genre Summary (all 81 ratings, 1 omitted above): Action: 60, Horror: 20, Comedy: 1');
  });

  it('AC4: keeps the JSON response format block unchanged and integrates with OpenRouterProvider', async () => {
    const request = {
      userRatings: [makeRating(1, 9, ['Sci-Fi'])],
      candidatePool: [makeCandidate(101)],
      serendipityLevel: 85,
      apiKey: 'sk-or-test',
    };

    const prompt = buildOpenRouterPrompt(request);
    expect(prompt).toContain(`Output strictly valid JSON with this format:
{
  "taste_analysis": "2-sentence summary of user's taste.",
  "pool_rankings": [
    {
      "id": 12345,
      "score": 95,
      "reason": "Personalized reason",
      "serendipityType": "safe_bet",
      "highlightTags": ["Tag1", "Tag2"]
    }
  ],
  "unconstrained_discoveries": [
    {
      "title": "Movie Title",
      "year": "1994",
      "score": 90,
      "reason": "Reason",
      "highlightTags": ["Discovery"]
    }
  ]
}`);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                taste_analysis: 'Enjoys cerebral sci-fi with emotional stakes.',
                pool_rankings: [
                  {
                    id: 101,
                    score: 91,
                    reason: 'Shares the contemplative pacing you loved in Film_1_R9, making the genre leap worth the risk.',
                    serendipityType: 'wildcard_discovery',
                    highlightTags: ['Slow Burn', 'Bridge Pick'],
                  },
                ],
                unconstrained_discoveries: [
                  {
                    title: 'Stalker',
                    year: '1979',
                    score: 94,
                    reason: 'Philosophical sci-fi bridge.',
                    highlightTags: ['Discovery'],
                  },
                ],
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenRouterProvider();
    const result = await provider.generateRecommendations(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[1].content).toBe(prompt);
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].serendipityType).toBe('wildcard_discovery');
    expect(result.unconstrainedDiscoveries).toHaveLength(1);
  });
});
