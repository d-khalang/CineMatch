import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiProvider, GEMINI_AVAILABLE_MODELS } from '../geminiProvider';
import {
  OpenRouterProvider,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_AVAILABLE_MODELS,
  DEPRECATED_OPENROUTER_MODELS,
  sanitizeOpenRouterModel,
} from '../openRouterProvider';

describe('Cloud AI Providers Connection & Validation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('GeminiProvider', () => {
    const provider = new GeminiProvider();

    const mockCandidatePool = [
      {
        id: 1,
        title: 'Inception',
        overview: 'A mind-bending heist.',
        release_date: '2010-07-16',
        vote_average: 8.4,
        vote_count: 35000,
        poster_path: null,
        backdrop_path: null,
        genres: [{ id: 878, name: 'Sci-Fi' }],
      },
    ];

    const mockUserRatings = [
      {
        movieId: 99,
        title: 'Interstellar',
        rating: 10,
        posterPath: null,
        genres: ['Sci-Fi'],
        ratedAt: Date.now(),
      },
    ];

    it('registers gemini-3.8-flash and gemini-3.7-flash in GEMINI_AVAILABLE_MODELS', () => {
      expect(GEMINI_AVAILABLE_MODELS.some((m) => m.id === 'gemini-3.8-flash')).toBe(true);
      expect(GEMINI_AVAILABLE_MODELS.some((m) => m.id === 'gemini-3.7-flash')).toBe(true);

      const flash38 = GEMINI_AVAILABLE_MODELS.find((m) => m.id === 'gemini-3.8-flash');
      expect(flash38?.name).toContain('Latest & Recommended');

      const flash37 = GEMINI_AVAILABLE_MODELS.find((m) => m.id === 'gemini-3.7-flash');
      expect(flash37?.name).toContain('Gemini 3.7 Flash');

      // Preserves existing models
      expect(GEMINI_AVAILABLE_MODELS.some((m) => m.id === 'gemini-2.5-flash')).toBe(true);
      expect(GEMINI_AVAILABLE_MODELS.some((m) => m.id === 'gemini-2.0-flash')).toBe(true);
      expect(GEMINI_AVAILABLE_MODELS.some((m) => m.id === 'gemini-1.5-flash')).toBe(true);
      expect(GEMINI_AVAILABLE_MODELS.some((m) => m.id === 'gemini-2.5-pro')).toBe(true);
    });

    it('rejects empty or whitespace-only API keys', async () => {
      const result = await provider.testConnection('');
      expect(result.success).toBe(false);
      expect(result.message).toContain('API key is required');

      const whitespaceResult = await provider.testConnection('   ');
      expect(whitespaceResult.success).toBe(false);
    });

    it('defaults testConnection to gemini-3.8-flash and passes API key in x-goog-api-key header', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"status": "CONNECTED"}' }] } }],
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await provider.testConnection('test_gemini_key_xyz');
      expect(result.success).toBe(true);
      expect(result.message).toContain('gemini-3.8-flash');

      expect(fetchMock).toHaveBeenCalled();
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toContain('/models/gemini-3.8-flash:generateContent');
      expect(url).not.toContain('key=');
      expect(url).not.toContain('test_gemini_key_xyz');
      expect(options.headers['x-goog-api-key']).toBe('test_gemini_key_xyz');
    });

    it('supports testConnection explicitly with gemini-3.7-flash', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"status": "CONNECTED"}' }] } }],
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await provider.testConnection('test_gemini_key_xyz', 'gemini-3.7-flash');
      expect(result.success).toBe(true);
      expect(result.message).toContain('gemini-3.7-flash');

      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain('/models/gemini-3.7-flash:generateContent');
    });

    it('handles HTTP error responses gracefully', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          json: async () => ({ error: { message: 'API key not valid' } }),
        })
      );

      const result = await provider.testConnection('invalid_key');
      expect(result.success).toBe(false);
      expect(result.message).toContain('API key not valid');
    });

    it('generates recommendations with gemini-3.8-flash by default', async () => {
      const mockGeminiJson = JSON.stringify({
        taste_analysis: 'Cinematic taste leans towards complex cerebral thrillers.',
        pool_rankings: [
          {
            id: 1,
            score: 96,
            reason: 'Matches your fascination with mind-bending narratives.',
            serendipityType: 'safe_bet',
            highlightTags: ['Masterpiece', 'Mind-Bending'],
          },
        ],
        unconstrained_discoveries: [
          {
            title: 'Solaris',
            year: '1972',
            score: 91,
            reason: 'Classic philosophical sci-fi exploration.',
            highlightTags: ['Hidden Gem'],
          },
        ],
      });

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: mockGeminiJson }] } }],
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await provider.generateRecommendations({
        apiKey: 'test_gemini_key_xyz',
        userRatings: mockUserRatings,
        candidatePool: mockCandidatePool,
        serendipityLevel: 30,
      });

      expect(fetchMock).toHaveBeenCalled();
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toContain('/models/gemini-3.8-flash:generateContent');
      expect(options.headers['x-goog-api-key']).toBe('test_gemini_key_xyz');

      expect(result.recommendations.length).toBe(1);
      expect(result.recommendations[0].movie.title).toBe('Inception');
      expect(result.recommendations[0].score).toBe(96);
      expect(result.tasteAnalysis).toContain('Cinematic taste leans towards');
      expect(result.unconstrainedDiscoveries?.length).toBe(1);
      expect(result.unconstrainedDiscoveries?.[0]?.title).toBe('Solaris');
    });

    it('generates recommendations targeting gemini-3.7-flash when specified', async () => {
      const mockGeminiJson = JSON.stringify({
        taste_analysis: 'High appreciation for visionary directors.',
        pool_rankings: [
          {
            id: 1,
            score: 93,
            reason: 'Essential viewing for Nolan fans.',
            serendipityType: 'safe_bet',
            highlightTags: ['Atmospheric'],
          },
        ],
        unconstrained_discoveries: [],
      });

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: mockGeminiJson }] } }],
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await provider.generateRecommendations({
        apiKey: 'test_gemini_key_xyz',
        model: 'gemini-3.7-flash',
        userRatings: mockUserRatings,
        candidatePool: mockCandidatePool,
        serendipityLevel: 30,
      });

      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain('/models/gemini-3.7-flash:generateContent');
      expect(result.recommendations.length).toBe(1);
      expect(result.recommendations[0].score).toBe(93);
    });

    it('throws descriptive error if apiKey is missing in generateRecommendations', async () => {
      await expect(
        provider.generateRecommendations({
          apiKey: '',
          userRatings: mockUserRatings,
          candidatePool: mockCandidatePool,
          serendipityLevel: 30,
        })
      ).rejects.toThrow('Gemini API key is required');
    });
  });

  describe('OpenRouterProvider', () => {
    const provider = new OpenRouterProvider();

    it('rejects empty or whitespace-only API keys', async () => {
      const result = await provider.testConnection('');
      expect(result.success).toBe(false);
      expect(result.message).toContain('API key is required');
    });

    it('passes API key in Authorization Bearer header', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"status": "CONNECTED"}' } }],
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await provider.testConnection('sk-or-v1-testkey123');
      expect(result.success).toBe(true);

      const [, options] = fetchMock.mock.calls[0];
      expect(options.headers['Authorization']).toBe('Bearer sk-or-v1-testkey123');
    });

    it('defaults to openrouter/free when model is not specified or empty', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"status": "CONNECTED"}' } }],
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await provider.testConnection('sk-test-key');
      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(options.body);
      expect(payload.model).toBe('openrouter/free');
      expect(OPENROUTER_DEFAULT_MODEL).toBe('openrouter/free');

      // Also when passing empty whitespace
      await provider.testConnection('sk-test-key', '   ');
      const [, secondOptions] = fetchMock.mock.calls[1];
      const secondPayload = JSON.parse(secondOptions.body);
      expect(secondPayload.model).toBe('openrouter/free');
    });

    it('supports custom model names in testConnection', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"status": "CONNECTED"}' } }],
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const customModel = 'meta-llama/llama-3.3-70b-instruct:free';
      const result = await provider.testConnection('sk-test-key', customModel);

      expect(result.success).toBe(true);
      expect(result.message).toContain(customModel);
      const [, options] = fetchMock.mock.calls[0];
      const payload = JSON.parse(options.body);
      expect(payload.model).toBe(customModel);
    });

    it('handles wrong custom model name in testConnection with descriptive API error', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({
          error: {
            message: "No endpoints found for model 'invalid/nonexistent-model:free'. Please check model ID or availability.",
            code: 404,
          },
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await provider.testConnection('sk-test-key', 'invalid/nonexistent-model:free');
      expect(result.success).toBe(false);
      expect(result.message).toBe(
        "OpenRouter Error: No endpoints found for model 'invalid/nonexistent-model:free'. Please check model ID or availability."
      );
    });

    it('handles wrong custom model name fallback when API returns no json body', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => {
          throw new Error('Not JSON');
        },
      });
      vi.stubGlobal('fetch', fetchMock);

      const result = await provider.testConnection('sk-test-key', 'bad-model-slug');
      expect(result.success).toBe(false);
      expect(result.message).toBe('OpenRouter Error: Bad Request');
    });

    it('handles wrong custom model name in generateRecommendations by throwing descriptive error', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({
          error: {
            message: "Model 'meta-llama/wrong-model' does not exist",
          },
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        provider.generateRecommendations({
          apiKey: 'sk-test-key',
          model: 'meta-llama/wrong-model',
          userRatings: [
            {
              movieId: 1,
              title: 'Movie 1',
              rating: 8,
              posterPath: null,
              genres: ['Action'],
              ratedAt: Date.now(),
            },
          ],
          candidatePool: [
            {
              id: 10,
              title: 'Candidate 10',
              overview: 'Overview 10',
              release_date: '2020-01-01',
              vote_average: 8.0,
              vote_count: 100,
              poster_path: null,
              backdrop_path: null,
              genres: [{ id: 28, name: 'Action' }],
            },
          ],
          serendipityLevel: 30,
        })
      ).rejects.toThrow("OpenRouter API error: Model 'meta-llama/wrong-model' does not exist");
    });

    it('strips <think> reasoning tags and parses clean JSON from models', async () => {
      const rawJson = JSON.stringify({
        taste_analysis: 'User likes fast-paced action.',
        pool_rankings: [
          {
            id: 10,
            score: 95,
            reason: 'Great action match',
            serendipityType: 'safe_bet',
            highlightTags: ['Action'],
          },
        ],
        unconstrained_discoveries: [],
      });

      const contentWithThink = `<think>
Analyzing user ratings...
Movie 1 has action.
Candidate 10 is an action film.
</think>
\`\`\`json
${rawJson}
\`\`\``;

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: contentWithThink } }],
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const res = await provider.generateRecommendations({
        apiKey: 'sk-test-key',
        model: 'openrouter/free',
        userRatings: [
          {
            movieId: 1,
            title: 'Movie 1',
            rating: 8,
            posterPath: null,
            genres: ['Action'],
            ratedAt: Date.now(),
          },
        ],
        candidatePool: [
          {
            id: 10,
            title: 'Candidate 10',
            overview: 'Overview 10',
            release_date: '2020-01-01',
            vote_average: 8.0,
            vote_count: 100,
            poster_path: null,
            backdrop_path: null,
            genres: [{ id: 28, name: 'Action' }],
          },
        ],
        serendipityLevel: 30,
      });

      expect(res.tasteAnalysis).toBe('User likes fast-paced action.');
      expect(res.recommendations.length).toBe(1);
      expect(res.recommendations[0].movie.title).toBe('Candidate 10');
    });

    describe('sanitizeOpenRouterModel', () => {
      it('replaces deprecated dead models with default openrouter/free', () => {
        expect(sanitizeOpenRouterModel('deepseek/deepseek-r1:free')).toBe('openrouter/free');
        expect(sanitizeOpenRouterModel('meta-llama/llama-3.3-70b-instruct:free')).toBe('openrouter/free');
        expect(sanitizeOpenRouterModel('google/gemini-2.0-flash-exp:free')).toBe('openrouter/free');
        expect(sanitizeOpenRouterModel('mistralai/mistral-small-24b-instruct-2501:free')).toBe('openrouter/free');
      });

      it('defaults undefined, null, or empty string to openrouter/free', () => {
        expect(sanitizeOpenRouterModel(undefined)).toBe('openrouter/free');
        expect(sanitizeOpenRouterModel('')).toBe('openrouter/free');
        expect(sanitizeOpenRouterModel('   ')).toBe('openrouter/free');
      });

      it('preserves valid custom model IDs and trims extra whitespace', () => {
        expect(sanitizeOpenRouterModel('google/gemma-4-31b-it:free')).toBe('google/gemma-4-31b-it:free');
        expect(sanitizeOpenRouterModel('openai/gpt-4o')).toBe('openai/gpt-4o');
        expect(sanitizeOpenRouterModel('  anthropic/claude-3.5-sonnet  ')).toBe('anthropic/claude-3.5-sonnet');
      });
    });
  });
});
